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
import type { CreateExpectedDeliveryDto } from './dto/create-expected-delivery.dto';
import type { ReceiveDevicesDto } from './dto/receive-devices.dto';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit') as typeof import('pdfkit');

@Injectable()
export class InboundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rateCard: RateCardService,
    private readonly audit: AuditService,
  ) {}

  findAllDeliveries(
    clientId?: string,
    expectedDate?: string,
  ): Prisma.PrismaPromise<
    Prisma.ExpectedDeliveryGetPayload<{
      include: {
        items: true;
        grns: { include: { assets: true } };
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

    return this.prisma.expectedDelivery.findMany({
      where: { ...(clientId ? { clientId } : {}), ...dateFilter },
      include: {
        items: true,
        grns: { include: { assets: true } },
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

    const occurredAt = new Date();
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
            model: device.model,
            manufacturer: device.manufacturer,
            category: device.category,
            clientId: delivery.clientId,
            currentLocationId: dto.receivingLocationId,
            currentStatus: device.requiresInspection ? 'in_inspection' : 'in_storage',
          },
        });
        assetEntries.push({ assetId: asset.id, category: device.category });

        if (device.requiresInspection) {
          await tx.inspection.create({
            data: {
              assetId: asset.id,
              type: 'inbound',
              status: 'in_progress',
              startedAt: occurredAt,
              startedByUserId: receivedByUserId,
            },
          });
          inspectionAssetIds.push(asset.id);
        }
      }

      // Generate sequential GRN number within the current month atomically
      const monthPrefix = `GRN-${occurredAt.getFullYear()}${String(occurredAt.getMonth() + 1).padStart(2, '0')}`;
      // pg_advisory_xact_lock takes an integer lock for the duration of the transaction,
      // serializing concurrent GRN inserts for the same month.
      const lockKey = occurredAt.getFullYear() * 100 + (occurredAt.getMonth() + 1);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${lockKey})`;
      const countResult = await tx.goodsReceivedNote.count({
        where: {
          receivedAt: { gte: new Date(occurredAt.getFullYear(), occurredAt.getMonth(), 1) },
        },
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
    doc.font('Helvetica').text(grn.expectedDelivery.purchaseOrderRef, 60, 191);
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
