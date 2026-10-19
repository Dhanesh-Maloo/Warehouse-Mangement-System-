import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { RateCardService } from '../rate-card/rate-card.service';
import { AuditService } from '../audit/audit.service';
import { AssetStatusHistoryService } from '../asset-status-history/asset-status-history.service';
import type { CreateExpectedDeliveryDto } from './dto/create-expected-delivery.dto';
import type { ReceiveDevicesDto } from './dto/receive-devices.dto';
import type { UpdateExpectedDeliveryDto } from './dto/update-expected-delivery.dto';
import type { UpdateGrnDto, UpdateReceivedDeviceDto } from './dto/update-grn.dto';
import { addBusinessMinutes } from '../common/business-hours.util';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit') as typeof import('pdfkit');

@Injectable()
export class InboundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateCard: RateCardService,
    private readonly audit: AuditService,
    private readonly assetStatusHistory: AssetStatusHistoryService,
  ) {}

  private getHolidaySet(): Set<string> {
    return new Set<string>();
  }

  findAllDeliveries(
    clientId?: string,
    expectedDate?: string,
    search?: string,
  ): Prisma.PrismaPromise<
    Prisma.ExpectedDeliveryGetPayload<{
      include: {
        items: true;
        grns: { include: { assets: { include: { asset: true } } } };
        client: { select: { id: true; name: true } };
      };
    }>[]
  > {
    const dateFilter = expectedDate
      ? {
          expectedArrivalDate: {
            gte: new Date(`${expectedDate}T00:00:00Z`),
            lte: new Date(`${expectedDate}T23:59:59Z`),
          },
        }
      : {};
    const searchFilter = search
      ? {
          OR: [
            { purchaseOrderRef: { contains: search, mode: 'insensitive' as const } },
            { ivalueTicketNumber: { contains: search, mode: 'insensitive' as const } },
            { clientTicketNumber: { contains: search, mode: 'insensitive' as const } },
            {
              grns: {
                some: {
                  assets: {
                    some: {
                      asset: {
                        OR: [
                          { referenceName: { contains: search, mode: 'insensitive' as const } },
                          { vendorName: { contains: search, mode: 'insensitive' as const } },
                        ],
                      },
                    },
                  },
                },
              },
            },
          ],
        }
      : {};

    return this.prisma.expectedDelivery.findMany({
      where: { ...(clientId ? { clientId } : {}), ...dateFilter, ...searchFilter },
      include: {
        items: true,
        grns: { include: { assets: { include: { asset: true } } } },
        client: { select: { id: true, name: true } },
      },
      orderBy: { expectedArrivalDate: 'desc' },
    });
  }

  async findOneDelivery(id: string): Promise<
    Prisma.ExpectedDeliveryGetPayload<{
      include: { items: true; grns: { include: { assets: { include: { asset: true } } } } };
    }>
  > {
    const delivery = await this.prisma.expectedDelivery.findUnique({
      where: { id },
      include: { items: true, grns: { include: { assets: { include: { asset: true } } } } },
    });
    if (!delivery) throw new NotFoundException(`Expected delivery ${id} not found`);
    return delivery;
  }

  async createExpectedDelivery(
    dto: CreateExpectedDeliveryDto,
    createdByUserId: string,
  ): Promise<Prisma.ExpectedDeliveryGetPayload<{ include: { items: true } }>> {
    const client = await this.prisma.client.findUnique({ where: { id: dto.clientId } });
    if (!client) throw new NotFoundException(`Client ${dto.clientId} not found`);

    const delivery = await this.prisma.expectedDelivery.create({
      data: {
        clientId: dto.clientId,
        purchaseOrderRef: dto.purchaseOrderRef,
        expectedArrivalDate: new Date(dto.expectedArrivalDate),
        ivalueTicketNumber: dto.ivalueTicketNumber,
        clientTicketNumber: dto.clientTicketNumber,
        notes: dto.notes,
        status: 'pending',
        items: {
          create: (dto.items ?? []).map((item) => ({
            category: item.category,
            model: item.model,
            manufacturer: item.manufacturer,
            quantity: item.quantity,
          })),
        },
      },
      include: { items: true },
    });

    await this.audit.log({
      userId: createdByUserId,
      action: 'inbound.createExpectedDelivery',
      entity: 'ExpectedDelivery',
      entityId: delivery.id,
      newValue: {
        clientId: dto.clientId,
        purchaseOrderRef: dto.purchaseOrderRef,
        expectedArrivalDate: dto.expectedArrivalDate,
      },
    });

    return delivery;
  }

  async receiveDevices(
    dto: ReceiveDevicesDto,
    receivedByUserId: string,
  ): Promise<
    Prisma.GoodsReceivedNoteGetPayload<{ include: { assets: { include: { asset: true } } } }>
  > {
    const delivery = await this.findOneDelivery(dto.expectedDeliveryId);

    if (delivery.status === 'cancelled') {
      throw new BadRequestException('Cannot receive against a cancelled delivery');
    }

    const location = await this.prisma.location.findUnique({
      where: { id: dto.receivingLocationId },
    });
    if (!location) throw new NotFoundException(`Location ${dto.receivingLocationId} not found`);

    // Vendor name only applies to new/sealed stock (inspection exempt); old/used
    // devices go through inspection instead and have no vendor to record.
    const missingVendor = dto.devices.find(
      (device) => !device.requiresInspection && !device.vendorName?.trim(),
    );
    if (missingVendor) {
      throw new BadRequestException(`Device ${missingVendor.serialNumber} is missing vendor name`);
    }

    const now = new Date();
    // Billing and "Date added" follow the date the devices were physically received.
    const occurredAt = dto.receivedAt ? this.resolveReceivedAt(dto.receivedAt, now) : now;
    if (occurredAt.getTime() > now.getTime() + 60_000) {
      throw new BadRequestException('Received date cannot be in the future');
    }
    const [ingestLaptopRate, ingestPeripheralRate, inspectRate] = await Promise.all([
      this.rateCard.findEffectiveAt('INGEST_LAPTOP', occurredAt),
      this.rateCard.findEffectiveAt('INGEST_PERIPHERAL', occurredAt),
      this.rateCard.findEffectiveAt('INSPECT', occurredAt),
    ]);
    const laptopIngestRate = ingestLaptopRate?.unitRatePaise ?? BigInt(0);
    const peripheralIngestRate = ingestPeripheralRate?.unitRatePaise ?? BigInt(0);
    const inspectUnitRate = inspectRate?.unitRatePaise ?? BigInt(0);

    return this.prisma.$transaction(async (tx) => {
      const assetEntries: { assetId: string; category: string }[] = [];
      const inspectionAssetIds: string[] = [];

      for (const device of dto.devices) {
        const existing = await tx.asset.findUnique({
          where: { serialNumber: device.serialNumber },
        });
        if (existing) {
          if (!dto.forceOverride) {
            throw new ConflictException({
              statusCode: 409,
              error: 'Conflict',
              message: `Serial number ${device.serialNumber} already exists`,
              code: 'SERIAL_NUMBER_DUPLICATE',
              serialNumber: device.serialNumber,
            });
          }
          // forceOverride=true: skip this device (it already exists in the system)
          // Do not create a duplicate asset; skip to next device
          assetEntries.push({ assetId: existing.id, category: existing.category });
          if (device.requiresInspection) {
            inspectionAssetIds.push(existing.id);
          }
          continue;
        }

        const asset = await tx.asset.create({
          data: {
            serialNumber: device.serialNumber,
            assetTag: device.assetTag,
            referenceName: device.referenceName,
            vendorName: device.requiresInspection ? null : device.vendorName,
            model: device.model,
            manufacturer: device.manufacturer,
            category: device.category,
            assetCondition: device.isNew ? 'new' : 'used',
            clientId: delivery.clientId,
            currentLocationId: dto.receivingLocationId,
            currentStatus: device.requiresInspection ? 'in_inspection' : 'in_storage',
            createdAt: occurredAt,
          },
        });
        assetEntries.push({ assetId: asset.id, category: device.category });
        await this.assetStatusHistory.record(
          {
            assetId: asset.id,
            clientId: delivery.clientId,
            fromStatus: null,
            toStatus: asset.currentStatus,
            sourceModule: 'inbound',
          },
          tx,
        );

        if (device.requiresInspection) {
          // The SLA clock starts when the inspection really begins, not on a backdated receipt date.
          const slaTargetAt = addBusinessMinutes(now, 1440, this.getHolidaySet());
          await tx.inspection.create({
            data: {
              assetId: asset.id,
              type: 'inbound',
              status: 'in_progress',
              startedAt: now,
              startedByUserId: receivedByUserId,
              slaTargetAt,
            },
          });
          inspectionAssetIds.push(asset.id);
        }
      }

      // Generate sequential GRN number within the current month atomically
      const monthPrefix = `GRN-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;
      // pg_advisory_xact_lock takes an integer lock for the duration of the transaction,
      // serializing concurrent GRN inserts for the same month.
      const lockKey = now.getFullYear() * 100 + (now.getMonth() + 1);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
      // Count by number prefix, not receivedAt: a backdated receipt must still take the next sequence number.
      const countResult = await tx.goodsReceivedNote.count({
        where: { grnNumber: { startsWith: `${monthPrefix}-` } },
      });
      const grnNumber = `${monthPrefix}-${String(countResult + 1).padStart(4, '0')}`;

      const grn = await tx.goodsReceivedNote.create({
        data: {
          grnNumber,
          expectedDeliveryId: dto.expectedDeliveryId,
          receivedByUserId,
          receivingLocationId: dto.receivingLocationId,
          courierRef: dto.courierRef,
          receivedAt: occurredAt,
          deviceCount: dto.devices.length,
          assets: {
            create: assetEntries.map((entry, idx) => ({
              assetId: entry.assetId,
              requiresInspection: dto.devices[idx].requiresInspection,
            })),
          },
        },
        include: { assets: { include: { asset: true } } },
      });

      // Post one INGEST ledger event per device with per-category rate
      // Must use tx (not this.ledger) so assets created above are visible within the transaction
      for (const { assetId, category } of assetEntries) {
        const ingestUnitRate = category === 'peripheral' ? peripheralIngestRate : laptopIngestRate;
        await tx.eventLedger.create({
          data: {
            eventType: 'INGEST',
            asset: { connect: { id: assetId } },
            client: { connect: { id: delivery.clientId } },
            quantity: 1,
            unitRatePaise: ingestUnitRate,
            amountPaise: ingestUnitRate,
            occurredAt,
            createdBy: receivedByUserId,
            referenceId: grn.id,
            referenceType: 'grn',
          },
        });
      }

      // Post one INSPECT ledger event per device that requires inspection
      for (const assetId of inspectionAssetIds) {
        await tx.eventLedger.create({
          data: {
            eventType: 'INSPECT',
            asset: { connect: { id: assetId } },
            client: { connect: { id: delivery.clientId } },
            quantity: 1,
            unitRatePaise: inspectUnitRate,
            amountPaise: inspectUnitRate,
            occurredAt,
            createdBy: receivedByUserId,
            referenceId: grn.id,
            referenceType: 'grn',
          },
        });
      }

      const totalExpected = delivery.items.reduce((sum, item) => sum + item.quantity, 0);
      const totalReceived =
        delivery.grns.reduce((s, g) => s + g.deviceCount, 0) + dto.devices.length;

      await tx.expectedDelivery.update({
        where: { id: dto.expectedDeliveryId },
        data: {
          status: totalReceived >= totalExpected ? 'completed' : 'partially_received',
        },
      });

      await this.audit.log({
        userId: receivedByUserId,
        action: 'inbound.receiveDevices',
        entity: 'GoodsReceivedNote',
        entityId: grn.id,
        newValue: {
          grnNumber: grn.grnNumber,
          expectedDeliveryId: dto.expectedDeliveryId,
          deviceCount: dto.devices.length,
        },
      });

      return grn;
    });
  }

  /** Directly override the status of an expected delivery (admin/manager manual override). */
  async updateDeliveryStatus(
    id: string,
    status: 'pending' | 'partially_received' | 'completed' | 'cancelled',
    updatedByUserId: string,
  ): Promise<Prisma.ExpectedDeliveryGetPayload<{ include: { items: true; grns: true } }>> {
    const delivery = await this.prisma.expectedDelivery.findUnique({ where: { id } });
    if (!delivery) throw new NotFoundException(`Expected delivery ${id} not found`);
    const updated = await this.prisma.expectedDelivery.update({
      where: { id },
      data: { status },
      include: { items: true, grns: true },
    });
    await this.audit.log({
      userId: updatedByUserId,
      action: 'inbound.updateDeliveryStatus',
      entity: 'ExpectedDelivery',
      entityId: id,
      oldValue: { status: delivery.status },
      newValue: { status },
    });
    return updated;
  }

  async updateDeliveryTickets(
    id: string,
    dto: { ivalueTicketNumber?: string; clientTicketNumber?: string },
  ): Promise<Prisma.ExpectedDeliveryGetPayload<{ include: { items: true; grns: true } }>> {
    const delivery = await this.prisma.expectedDelivery.findUnique({ where: { id } });
    if (!delivery) throw new NotFoundException(`Expected delivery ${id} not found`);
    return this.prisma.expectedDelivery.update({
      where: { id },
      data: {
        ivalueTicketNumber: dto.ivalueTicketNumber,
        clientTicketNumber: dto.clientTicketNumber,
      },
      include: { items: true, grns: true },
    });
  }

  /** Edit an expected delivery after creation (fields and/or line items). */
  async updateDelivery(
    id: string,
    dto: UpdateExpectedDeliveryDto,
    updatedByUserId: string,
  ): Promise<Prisma.ExpectedDeliveryGetPayload<{ include: { items: true; grns: true } }>> {
    const delivery = await this.prisma.expectedDelivery.findUnique({
      where: { id },
      include: { items: true, grns: true },
    });
    if (!delivery) throw new NotFoundException(`Expected delivery ${id} not found`);
    if (delivery.status === 'cancelled') {
      throw new BadRequestException('Cannot edit a cancelled delivery');
    }

    const totalReceived = delivery.grns.reduce((s, g) => s + g.deviceCount, 0);
    if (dto.items) {
      const existingIds = new Set(delivery.items.map((i) => i.id));
      if (dto.items.some((i) => i.id && !existingIds.has(i.id))) {
        throw new BadRequestException('An item does not belong to this delivery');
      }
      if (dto.items.length === 0) {
        throw new BadRequestException('A delivery needs at least one item');
      }
      const newTotal = dto.items.reduce((s, i) => s + i.quantity, 0);
      if (newTotal < totalReceived) {
        throw new BadRequestException(
          `Total quantity (${newTotal}) cannot be lower than the ${totalReceived} device(s) already received`,
        );
      }
    }

    // '' clears an optional text field; undefined leaves it untouched.
    const text = (v: string | undefined): string | null | undefined =>
      v === undefined ? undefined : v.trim() || null;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (dto.items) {
        const keepIds = new Set(dto.items.filter((i) => i.id).map((i) => i.id as string));
        const removed = delivery.items.filter((i) => !keepIds.has(i.id));
        if (removed.some((i) => i.receivedQuantity > 0)) {
          throw new BadRequestException('Cannot remove an item that already has received devices');
        }
        if (removed.length > 0) {
          await tx.expectedDeliveryItem.deleteMany({
            where: { id: { in: removed.map((i) => i.id) } },
          });
        }
        for (const item of dto.items) {
          const data = {
            category: item.category,
            model: item.model.trim(),
            manufacturer: item.manufacturer.trim(),
            quantity: item.quantity,
          };
          if (item.id) {
            await tx.expectedDeliveryItem.update({ where: { id: item.id }, data });
          } else {
            await tx.expectedDeliveryItem.create({ data: { ...data, deliveryId: id } });
          }
        }
      }

      // Re-derive status only when quantities changed, so a manual status
      // override isn't silently reverted by an unrelated edit.
      let status: 'pending' | 'partially_received' | 'completed' | undefined;
      if (dto.items) {
        const newTotal = dto.items.reduce((s, i) => s + i.quantity, 0);
        status =
          totalReceived >= newTotal
            ? 'completed'
            : totalReceived > 0
              ? 'partially_received'
              : 'pending';
      }

      return tx.expectedDelivery.update({
        where: { id },
        data: {
          purchaseOrderRef: text(dto.purchaseOrderRef),
          expectedArrivalDate: dto.expectedArrivalDate
            ? new Date(dto.expectedArrivalDate)
            : undefined,
          notes: text(dto.notes),
          ivalueTicketNumber: text(dto.ivalueTicketNumber),
          clientTicketNumber: text(dto.clientTicketNumber),
          status,
        },
        include: { items: true, grns: true },
      });
    });

    await this.audit.log({
      userId: updatedByUserId,
      action: 'inbound.updateDelivery',
      entity: 'ExpectedDelivery',
      entityId: id,
      oldValue: {
        purchaseOrderRef: delivery.purchaseOrderRef,
        expectedArrivalDate: delivery.expectedArrivalDate,
        notes: delivery.notes,
        ivalueTicketNumber: delivery.ivalueTicketNumber,
        clientTicketNumber: delivery.clientTicketNumber,
        status: delivery.status,
        items: delivery.items.map((i) => ({
          category: i.category,
          model: i.model,
          manufacturer: i.manufacturer,
          quantity: i.quantity,
        })),
      },
      newValue: {
        purchaseOrderRef: updated.purchaseOrderRef,
        expectedArrivalDate: updated.expectedArrivalDate,
        notes: updated.notes,
        ivalueTicketNumber: updated.ivalueTicketNumber,
        clientTicketNumber: updated.clientTicketNumber,
        status: updated.status,
        items: updated.items.map((i) => ({
          category: i.category,
          model: i.model,
          manufacturer: i.manufacturer,
          quantity: i.quantity,
        })),
      },
    });

    return updated;
  }

  /** Client that owns a GRN, for controller-level tenancy checks. */
  async getGrnClientId(grnId: string): Promise<string> {
    const grn = await this.prisma.goodsReceivedNote.findUnique({
      where: { id: grnId },
      select: { expectedDelivery: { select: { clientId: true } } },
    });
    if (!grn) throw new NotFoundException(`GRN ${grnId} not found`);
    return grn.expectedDelivery.clientId;
  }

  /**
   * Edit a GRN. Changing the received date posts reversal rows for the
   * original INGEST/INSPECT events and re-posts them on the corrected date
   * (rate looked up as of that date), since the ledger itself is never edited.
   */
  async updateGrn(
    grnId: string,
    dto: UpdateGrnDto,
    updatedByUserId: string,
  ): Promise<
    Prisma.GoodsReceivedNoteGetPayload<{ include: { assets: { include: { asset: true } } } }>
  > {
    const grn = await this.prisma.goodsReceivedNote.findUnique({
      where: { id: grnId },
      include: { assets: { include: { asset: true } }, expectedDelivery: true },
    });
    if (!grn) throw new NotFoundException(`GRN ${grnId} not found`);

    let newReceivedAt: Date | undefined;
    if (dto.receivedAt) {
      newReceivedAt = this.resolveReceivedAt(dto.receivedAt, grn.receivedAt);
      if (newReceivedAt.getTime() > Date.now() + 60_000) {
        throw new BadRequestException('Received date cannot be in the future');
      }
      if (newReceivedAt.getTime() === grn.receivedAt.getTime()) newReceivedAt = undefined;
    }

    const [ingestLaptopRate, ingestPeripheralRate, inspectRate] = newReceivedAt
      ? await Promise.all([
          this.rateCard.findEffectiveAt('INGEST_LAPTOP', newReceivedAt),
          this.rateCard.findEffectiveAt('INGEST_PERIPHERAL', newReceivedAt),
          this.rateCard.findEffectiveAt('INSPECT', newReceivedAt),
        ])
      : [null, null, null];

    const updated = await this.prisma.$transaction(
      async (tx) => {
        const result = await tx.goodsReceivedNote.update({
          where: { id: grnId },
          data: {
            receivedAt: newReceivedAt,
            courierRef: dto.courierRef === undefined ? undefined : dto.courierRef.trim() || null,
            notes: dto.notes === undefined ? undefined : dto.notes.trim() || null,
          },
          include: { assets: { include: { asset: true } } },
        });

        if (newReceivedAt) {
          const categoryByAsset = new Map(grn.assets.map((a) => [a.assetId, a.asset.category]));
          const originals = await tx.eventLedger.findMany({
            where: {
              referenceType: 'grn',
              referenceId: grnId,
              eventType: { in: ['INGEST', 'INSPECT'] },
            },
          });
          const originalIds = originals.map((e) => e.id);
          const [alreadyReversed, suppressed] = await Promise.all([
            tx.eventLedger.findMany({
              where: { referenceType: 'correction', referenceId: { in: originalIds } },
              select: { referenceId: true },
            }),
            tx.eventSuppression.findMany({
              where: { suppressedEventId: { in: originalIds } },
              select: { suppressedEventId: true },
            }),
          ]);
          const skip = new Set([
            ...alreadyReversed.map((e) => e.referenceId),
            ...suppressed.map((s) => s.suppressedEventId),
          ]);
          // Suppressed events (covered by a bundle charge) aren't billed, so
          // reversing them would credit money that was never charged.
          const live = originals.filter((e) => !skip.has(e.id));

          const note = `Received date corrected on ${grn.grnNumber ?? grnId}`;
          await tx.eventLedger.createMany({
            data: live.map((e) => ({
              eventType: `CORRECTION_${e.eventType}`,
              assetId: e.assetId,
              clientId: e.clientId,
              quantity: -e.quantity,
              unitRatePaise: e.unitRatePaise,
              amountPaise: -e.amountPaise,
              // Reverse in the original period so that period nets to zero.
              occurredAt: e.occurredAt,
              createdBy: updatedByUserId,
              referenceId: e.id,
              referenceType: 'correction',
              notes: note,
            })),
          });
          await tx.eventLedger.createMany({
            data: live.map((e) => {
              const rate =
                e.eventType === 'INSPECT'
                  ? inspectRate
                  : categoryByAsset.get(e.assetId) === 'peripheral'
                    ? ingestPeripheralRate
                    : ingestLaptopRate;
              const unitRatePaise = rate?.unitRatePaise ?? BigInt(0);
              return {
                eventType: e.eventType,
                assetId: e.assetId,
                clientId: e.clientId,
                quantity: e.quantity,
                unitRatePaise,
                amountPaise: unitRatePaise * BigInt(e.quantity),
                occurredAt: newReceivedAt as Date,
                createdBy: updatedByUserId,
                referenceId: grnId,
                referenceType: 'grn',
                notes: note,
              };
            }),
          });
        }
        return result;
      },
      { timeout: 30_000 },
    );

    await this.audit.log({
      userId: updatedByUserId,
      action: 'inbound.updateGrn',
      entity: 'GoodsReceivedNote',
      entityId: grnId,
      oldValue: { receivedAt: grn.receivedAt, courierRef: grn.courierRef, notes: grn.notes },
      newValue: {
        receivedAt: updated.receivedAt,
        courierRef: updated.courierRef,
        notes: updated.notes,
      },
    });

    return updated;
  }

  /** Edit descriptive/identity fields of a device received on a GRN. */
  async updateReceivedDevice(
    grnId: string,
    assetId: string,
    dto: UpdateReceivedDeviceDto,
    updatedByUserId: string,
  ): Promise<Prisma.AssetGetPayload<Record<string, never>>> {
    const link = await this.prisma.grnAsset.findFirst({
      where: { grnId, assetId },
      include: { asset: true },
    });
    if (!link) throw new NotFoundException(`Device ${assetId} was not received on GRN ${grnId}`);
    const before = link.asset;

    const required = (v: string | undefined, label: string): string | undefined => {
      if (v === undefined) return undefined;
      const t = v.trim();
      if (!t) throw new BadRequestException(`${label} cannot be empty`);
      return t;
    };
    const optional = (v: string | undefined): string | null | undefined =>
      v === undefined ? undefined : v.trim() || null;

    const serialNumber = required(dto.serialNumber, 'Serial number');
    if (serialNumber && serialNumber !== before.serialNumber) {
      const clash = await this.prisma.asset.findUnique({ where: { serialNumber } });
      if (clash) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: `Serial number ${serialNumber} already exists`,
          code: 'SERIAL_NUMBER_DUPLICATE',
          serialNumber,
        });
      }
    }

    const updated = await this.prisma.asset.update({
      where: { id: assetId },
      data: {
        serialNumber,
        model: required(dto.model, 'Model'),
        manufacturer: required(dto.manufacturer, 'Manufacturer'),
        referenceName: optional(dto.referenceName),
        vendorName: optional(dto.vendorName),
        assetCondition: dto.assetCondition,
      },
    });

    await this.audit.log({
      userId: updatedByUserId,
      action: 'inbound.updateReceivedDevice',
      entity: 'Asset',
      entityId: assetId,
      oldValue: {
        serialNumber: before.serialNumber,
        model: before.model,
        manufacturer: before.manufacturer,
        referenceName: before.referenceName,
        vendorName: before.vendorName,
        assetCondition: before.assetCondition,
      },
      newValue: {
        serialNumber: updated.serialNumber,
        model: updated.model,
        manufacturer: updated.manufacturer,
        referenceName: updated.referenceName,
        vendorName: updated.vendorName,
        assetCondition: updated.assetCondition,
      },
    });

    return updated;
  }

  /**
   * A date-only value (YYYY-MM-DD) means "that day in IST", keeping the original
   * time of day so same-day ordering of receipts is preserved.
   */
  private resolveReceivedAt(input: string, current: Date): Date {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return new Date(input);
    const time = current.toLocaleTimeString('en-GB', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
    });
    return new Date(`${input}T${time}+05:30`);
  }

  findAllGrns(clientId?: string): Prisma.PrismaPromise<
    Prisma.GoodsReceivedNoteGetPayload<{
      include: { assets: { include: { asset: true } }; expectedDelivery: true };
    }>[]
  > {
    return this.prisma.goodsReceivedNote.findMany({
      where: clientId ? { expectedDelivery: { clientId } } : {},
      include: { assets: { include: { asset: true } }, expectedDelivery: true },
      orderBy: { receivedAt: 'desc' },
    });
  }

  async generateGrnPdf(
    grnId: string,
    requestingClientId?: string,
  ): Promise<{ stream: NodeJS.ReadableStream; filename: string }> {
    const grn = await this.prisma.goodsReceivedNote.findUnique({
      where: { id: grnId },
      include: {
        expectedDelivery: { include: { client: true } },
        receivedByUser: { select: { fullName: true } },
        receivingLocation: { select: { name: true } },
        assets: {
          include: {
            asset: {
              select: {
                serialNumber: true,
                assetTag: true,
                model: true,
                category: true,
                manufacturer: true,
              },
            },
          },
        },
      },
    });
    if (!grn) throw new NotFoundException(`GRN ${grnId} not found`);
    if (requestingClientId && grn.expectedDelivery.clientId !== requestingClientId) {
      throw new ForbiddenException('Cannot download a GRN from another client');
    }

    const displayNumber =
      grn.grnNumber ??
      `GRN-${grn.receivedAt.toISOString().slice(0, 7).replace('-', '')}-${grn.id.slice(-4).toUpperCase()}`;
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('IValue WMS', 50, 50);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#666666')
      .text('Warehouse Management System', 50, 74);
    doc
      .fillColor('#000000')
      .fontSize(18)
      .font('Helvetica-Bold')
      .text('Goods Received Note', 50, 100);

    // GRN metadata box
    doc.rect(50, 130, 495, 80).stroke('#cccccc');
    doc.fontSize(9).font('Helvetica-Bold').text('GRN Number', 60, 140);
    doc.font('Helvetica').fontSize(12).text(displayNumber, 60, 153);
    doc.fontSize(9).font('Helvetica-Bold').text('Client', 220, 140);
    doc.font('Helvetica').fontSize(11).text(grn.expectedDelivery.client.name, 220, 153);
    doc.fontSize(9).font('Helvetica-Bold').text('Received at', 400, 140);
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(
        grn.receivedAt.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        400,
        153,
      );
    doc.fontSize(9).font('Helvetica-Bold').text('PO Reference', 60, 178);
    doc.font('Helvetica').text(grn.expectedDelivery.purchaseOrderRef ?? '—', 60, 191);
    doc.fontSize(9).font('Helvetica-Bold').text('Location', 220, 178);
    doc.font('Helvetica').text(grn.receivingLocation.name, 220, 191);
    doc.fontSize(9).font('Helvetica-Bold').text('Received by', 400, 178);
    doc.font('Helvetica').text(grn.receivedByUser.fullName, 400, 191);

    // Courier ref
    if (grn.courierRef) {
      doc.fontSize(9).font('Helvetica-Bold').text('Courier reference:', 50, 222);
      doc.font('Helvetica').text(grn.courierRef, 155, 222);
    }

    // Devices table
    const tableTop = grn.courierRef ? 245 : 228;
    doc
      .fontSize(10)
      .font('Helvetica-Bold')
      .text(`Received devices (${grn.assets.length})`, 50, tableTop);

    const tableStart = tableTop + 18;
    doc.rect(50, tableStart, 495, 20).fill('#1A2B3C');
    doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
    doc.text('#', 55, tableStart + 6);
    doc.text('Serial number', 75, tableStart + 6);
    doc.text('Asset tag', 225, tableStart + 6);
    doc.text('Model', 315, tableStart + 6);
    doc.text('Category', 435, tableStart + 6);
    doc.fillColor('#000000');

    grn.assets.forEach(({ asset }, idx) => {
      const y = tableStart + 20 + idx * 22;
      if (idx % 2 === 0) doc.rect(50, y, 495, 22).fill('#f8f8f8');
      doc.fillColor('#000000').font('Helvetica').fontSize(8);
      doc.text(String(idx + 1), 55, y + 7);
      doc.text(asset.serialNumber, 75, y + 7, { width: 145 });
      doc.text(asset.assetTag ?? '—', 225, y + 7, { width: 85 });
      doc.text(`${asset.manufacturer} ${asset.model}`, 315, y + 7, { width: 115 });
      doc.text(asset.category, 435, y + 7);
    });

    // Footer
    const footerY = Math.max(tableStart + 20 + grn.assets.length * 22 + 40, 680);
    doc.moveTo(50, footerY).lineTo(545, footerY).stroke('#cccccc');
    doc
      .fontSize(8)
      .fillColor('#888888')
      .text(
        `Generated by IValue WMS · ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
        50,
        footerY + 8,
        { align: 'center', width: 495 },
      );

    doc.end();
    return { stream: doc, filename: `${displayNumber}.pdf` };
  }
}
