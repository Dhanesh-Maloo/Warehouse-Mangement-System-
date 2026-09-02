import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import type { Prisma, DeploymentOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { RateCardService } from '../rate-card/rate-card.service';
import { AuditService } from '../audit/audit.service';
import { CourierZoneService } from '../logistics/courier-zone.service';
import { AssetStatusHistoryService } from '../asset-status-history/asset-status-history.service';
import type { CreateDeploymentOrderDto } from './dto/create-deployment-order.dto';
import type { UpdateDeploymentStatusDto } from './dto/update-deployment-status.dto';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit') as typeof import('pdfkit');

@Injectable()
export class DeploymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rateCard: RateCardService,
    private readonly audit: AuditService,
    private readonly courierZone: CourierZoneService,
    private readonly assetStatusHistory: AssetStatusHistoryService,
  ) {}

  /**
   * List all deployment orders, optionally filtered by clientId.
   * Results include the related asset and endUser records.
   */
  findAll(
    clientId?: string,
    search?: string,
    status?: string,
  ): Prisma.PrismaPromise<
    Prisma.DeploymentOrderGetPayload<{ include: { asset: true; endUser: true } }>[]
  > {
    const searchFilter = search
      ? {
          OR: [
            { ivalueTicketNumber: { contains: search, mode: 'insensitive' as const } },
            { clientTicketNumber: { contains: search, mode: 'insensitive' as const } },
            { trackingNumber: { contains: search, mode: 'insensitive' as const } },
            { asset: { serialNumber: { contains: search, mode: 'insensitive' as const } } },
            { asset: { assetTag: { contains: search, mode: 'insensitive' as const } } },
            { endUser: { name: { contains: search, mode: 'insensitive' as const } } },
          ],
        }
      : {};
    return this.prisma.deploymentOrder.findMany({
      where: {
        ...(clientId ? { clientId } : {}),
        ...(status ? { status: status as DeploymentOrderStatus } : {}),
        ...searchFilter,
      },
      include: { asset: true, endUser: true },
      orderBy: { requestedAt: 'desc' },
    });
  }

  /**
   * Get a single deployment order by id.
   * Throws NotFoundException when not found.
   */
  async findOne(id: string): Promise<
    Prisma.DeploymentOrderGetPayload<{
      include: {
        asset: true;
        endUser: true;
        createdByUser: { select: { id: true; fullName: true } };
      };
    }>
  > {
    const order = await this.prisma.deploymentOrder.findUnique({
      where: { id },
      include: {
        asset: true,
        endUser: true,
        createdByUser: { select: { id: true, fullName: true } },
      },
    });
    if (!order) throw new NotFoundException(`Deployment order ${id} not found`);
    return order;
  }

  /**
   * Create a deployment order and post the corresponding ledger events
   * for the bundle type, courier zone, and any optional add-ons.
   * Also marks the asset as deployed.
   * Everything runs inside a single Prisma transaction.
   */
  async create(
    dto: CreateDeploymentOrderDto,
    createdByUserId: string,
  ): Promise<Prisma.DeploymentOrderGetPayload<{ include: { asset: true; endUser: true } }>> {
    const asset = await this.prisma.asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new NotFoundException(`Asset ${dto.assetId} not found`);

    if (asset.clientId !== dto.clientId) {
      throw new BadRequestException(
        `Asset ${dto.assetId} does not belong to client ${dto.clientId}`,
      );
    }

    const occurredAt = new Date();
    const bundleType = dto.bundleType ?? 'standard';

    // Resolve all rate cards before entering the transaction so that a missing
    // rate code surfaces as a clear error before any DB writes happen.
    const bundleRateCode = bundleType === 'full_prep' ? 'FULL_PREP' : 'PICK_PACK';
    const bundleRate = await this.rateCard.findEffectiveAt(bundleRateCode, occurredAt);
    const bundleUnitRate = bundleRate ? bundleRate.unitRatePaise : BigInt(0);

    // Courier zone is derived server-side from the delivery pincode — never
    // trust a client-supplied zone for billing.
    const courierZone = await this.courierZone.resolveZone(dto.deliveryAddress.pincode);
    const courierCodeMap = {
      intra_state: 'COURIER_CITY',
      inter_state: 'COURIER_INTERSTATE',
      rural: 'COURIER_RURAL',
    } as const;
    const courierCode = courierCodeMap[courierZone];
    const courierRate = await this.rateCard.findEffectiveAt(courierCode, occurredAt);
    const courierUnitRate = courierRate ? courierRate.unitRatePaise : BigInt(0);

    let labelingUnitRate = BigInt(0);
    if (dto.requiresLabeling) {
      const labelingRate = await this.rateCard.findEffectiveAt('LABELING', occurredAt);
      labelingUnitRate = labelingRate ? labelingRate.unitRatePaise : BigInt(0);
    }

    let repackingUnitRate = BigInt(0);
    if (dto.requiresRepacking) {
      const repackingRate = await this.rateCard.findEffectiveAt('REPACKING', occurredAt);
      repackingUnitRate = repackingRate ? repackingRate.unitRatePaise : BigInt(0);
    }

    return this.prisma.$transaction(async (tx) => {
      // Create the deployment order record
      const order = await tx.deploymentOrder.create({
        data: {
          clientId: dto.clientId,
          assetId: dto.assetId,
          endUserId: dto.endUserId ?? null,
          bundleType,
          deliveryAddress: dto.deliveryAddress as object,
          contactName: dto.contactName,
          contactPhone: dto.contactPhone,
          courierZone,
          requiresLabeling: dto.requiresLabeling ?? false,
          requiresRepacking: dto.requiresRepacking ?? false,
          ivalueTicketNumber: dto.ivalueTicketNumber,
          clientTicketNumber: dto.clientTicketNumber,
          notes: dto.notes ?? null,
          createdByUserId,
          status: 'pending',
        },
        include: { asset: true, endUser: true },
      });

      // Mark asset as deployed and record the end user if provided
      await tx.asset.update({
        where: { id: dto.assetId },
        data: {
          currentStatus: 'deployed',
          ...(dto.endUserId ? { currentEndUserId: dto.endUserId } : {}),
        },
      });
      await this.assetStatusHistory.record(
        {
          assetId: dto.assetId,
          clientId: dto.clientId,
          fromStatus: order.asset.currentStatus,
          toStatus: 'deployed',
          sourceModule: 'deployment',
        },
        tx,
      );

      // Post bundle ledger event (FULL_PREP or PICK_PACK)
      const bundleEvent = await this.ledger.create({
        eventType: bundleRateCode,
        asset: { connect: { id: dto.assetId } },
        client: { connect: { id: dto.clientId } },
        quantity: 1,
        unitRatePaise: bundleUnitRate,
        amountPaise: bundleUnitRate,
        occurredAt,
        createdBy: createdByUserId,
        referenceId: order.id,
        referenceType: 'deployment_order',
      });

      // Post courier ledger event
      await this.ledger.create({
        eventType: courierCode,
        asset: { connect: { id: dto.assetId } },
        client: { connect: { id: dto.clientId } },
        quantity: 1,
        unitRatePaise: courierUnitRate,
        amountPaise: courierUnitRate,
        occurredAt,
        createdBy: createdByUserId,
        referenceId: order.id,
        referenceType: 'deployment_order',
      });

      // Post labeling ledger event if requested
      if (dto.requiresLabeling) {
        await this.ledger.create({
          eventType: 'LABELING',
          asset: { connect: { id: dto.assetId } },
          client: { connect: { id: dto.clientId } },
          quantity: 1,
          unitRatePaise: labelingUnitRate,
          amountPaise: labelingUnitRate,
          occurredAt,
          createdBy: createdByUserId,
          referenceId: order.id,
          referenceType: 'deployment_order',
        });
      }

      // Post repacking ledger event if requested
      if (dto.requiresRepacking) {
        await this.ledger.create({
          eventType: 'REPACKING',
          asset: { connect: { id: dto.assetId } },
          client: { connect: { id: dto.clientId } },
          quantity: 1,
          unitRatePaise: repackingUnitRate,
          amountPaise: repackingUnitRate,
          occurredAt,
          createdBy: createdByUserId,
          referenceId: order.id,
          referenceType: 'deployment_order',
        });
      }

      // If FULL_PREP: suppress component INGEST and INSPECT ledger events for this asset
      if (bundleType === 'full_prep') {
        const componentEvents = await tx.eventLedger.findMany({
          where: {
            assetId: dto.assetId,
            eventType: { in: ['INGEST', 'INSPECT', 'INGEST_LAPTOP', 'INGEST_PERIPHERAL'] },
          },
          select: { id: true },
        });
        for (const evt of componentEvents) {
          await tx.eventSuppression
            .create({
              data: {
                suppressedEventId: evt.id,
                suppressedByEventId: bundleEvent.id,
                assetId: dto.assetId,
                clientId: dto.clientId,
              },
            })
            .catch(() => {
              // suppressedEventId is @unique — ignore if already suppressed
            });
        }
      }

      await this.audit.log({
        userId: createdByUserId,
        action: 'deployment.create',
        entity: 'DeploymentOrder',
        entityId: order.id,
        newValue: { assetId: dto.assetId, endUserId: dto.endUserId ?? null, status: 'pending' },
      });

      return order;
    });
  }

  /**
   * Update the status of a deployment order.
   * Sets phase timestamps automatically:
   *   picking     -> processedAt
   *   dispatched  -> dispatchedAt
   *   delivered   -> deliveredAt
   */
  async updateStatus(
    id: string,
    dto: UpdateDeploymentStatusDto,
    updatedByUserId: string,
  ): Promise<Prisma.DeploymentOrderGetPayload<{ include: { asset: true; endUser: true } }>> {
    const order = await this.findOne(id);

    const DEPLOYMENT_TRANSITIONS: Record<string, string[]> = {
      pending: ['in_transit', 'cancelled'],
      in_transit: ['delivered', 'cancelled'],
      delivered: [],
      cancelled: [],
    };

    const allowed = DEPLOYMENT_TRANSITIONS[order.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition deployment order from '${order.status}' to '${dto.status}'`,
      );
    }

    const now = new Date();
    const timestampPatch: Record<string, Date> = {};
    if (dto.status === 'in_transit') timestampPatch.dispatchedAt = now;
    if (dto.status === 'delivered') timestampPatch.deliveredAt = now;

    const updated = await this.prisma.deploymentOrder.update({
      where: { id },
      data: {
        status: dto.status,
        ...(dto.trackingNumber !== undefined && { trackingNumber: dto.trackingNumber }),
        ...(dto.courierName !== undefined && { courierName: dto.courierName }),
        ...(dto.actualCarrierCostPaise !== undefined && {
          actualCarrierCostPaise: BigInt(dto.actualCarrierCostPaise),
        }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...timestampPatch,
      },
      include: { asset: true, endUser: true },
    });

    await this.audit.log({
      userId: updatedByUserId,
      action: 'deployment.updateStatus',
      entity: 'DeploymentOrder',
      entityId: id,
      oldValue: { status: order.status },
      newValue: { status: dto.status, trackingNumber: dto.trackingNumber },
    });

    return updated;
  }

  /** Update only the courier zone of an order (no ledger correction). */
  async updateZone(
    id: string,
    courierZone: 'intra_state' | 'inter_state' | 'rural',
    updatedByUserId: string,
  ): Promise<Prisma.DeploymentOrderGetPayload<{ include: { asset: true; endUser: true } }>> {
    const order = await this.findOne(id);
    const updated = await this.prisma.deploymentOrder.update({
      where: { id },
      data: { courierZone },
      include: { asset: true, endUser: true },
    });
    await this.audit.log({
      userId: updatedByUserId,
      action: 'deployment.updateZone',
      entity: 'DeploymentOrder',
      entityId: id,
      oldValue: { courierZone: order.courierZone },
      newValue: { courierZone },
    });
    return updated;
  }

  /** Update only the tracking number of an order. */
  async updateTracking(
    id: string,
    trackingNumber: string,
    updatedByUserId: string,
  ): Promise<Prisma.DeploymentOrderGetPayload<{ include: { asset: true; endUser: true } }>> {
    await this.findOne(id);
    const updated = await this.prisma.deploymentOrder.update({
      where: { id },
      data: { trackingNumber },
      include: { asset: true, endUser: true },
    });
    await this.audit.log({
      userId: updatedByUserId,
      action: 'deployment.updateTracking',
      entity: 'DeploymentOrder',
      entityId: id,
      newValue: { trackingNumber },
    });
    return updated;
  }

  async updateTickets(
    id: string,
    dto: { ivalueTicketNumber?: string; clientTicketNumber?: string },
  ): Promise<Prisma.DeploymentOrderGetPayload<{ include: { asset: true; endUser: true } }>> {
    await this.findOne(id);
    return this.prisma.deploymentOrder.update({
      where: { id },
      data: {
        ivalueTicketNumber: dto.ivalueTicketNumber,
        clientTicketNumber: dto.clientTicketNumber,
      },
      include: { asset: true, endUser: true },
    });
  }

  /**
   * Find all deployment orders for a given asset.
   */
  findByAsset(
    assetId: string,
  ): Prisma.PrismaPromise<
    Prisma.DeploymentOrderGetPayload<{ include: { asset: true; endUser: true } }>[]
  > {
    return this.prisma.deploymentOrder.findMany({
      where: { assetId },
      include: { asset: true, endUser: true },
      orderBy: { requestedAt: 'desc' },
    });
  }

  /**
   * Delivery Challan (DC) — proves an asset + its details were delivered to
   * the end user, for handoff to the client. Available once the order is
   * marked 'delivered'. Mirrors Retrieval's confirmation PDF / Inbound's GRN.
   */
  async generateDeliveryChallanPdf(
    id: string,
    requestingClientId?: string,
  ): Promise<{ stream: NodeJS.ReadableStream; filename: string }> {
    const order = await this.prisma.deploymentOrder.findUnique({
      where: { id },
      include: {
        client: true,
        endUser: true,
        asset: {
          select: {
            serialNumber: true,
            assetTag: true,
            model: true,
            category: true,
            manufacturer: true,
          },
        },
        createdByUser: { select: { fullName: true } },
      },
    });
    if (!order) throw new NotFoundException(`Deployment order ${id} not found`);
    if (requestingClientId && order.clientId !== requestingClientId) {
      throw new ForbiddenException('Cannot download a delivery challan from another client');
    }
    if (order.status !== 'delivered') {
      throw new BadRequestException(
        'Delivery challan is only available once the order has been delivered',
      );
    }

    const displayNumber = `DC-${order.id.slice(-8).toUpperCase()}`;
    const address = order.deliveryAddress as {
      street?: string;
      city?: string;
      state?: string;
      pincode?: string;
    };
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('IValue WMS', 50, 50);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#666666')
      .text('Warehouse Management System', 50, 74);
    doc.fillColor('#000000').fontSize(18).font('Helvetica-Bold').text('Delivery Challan', 50, 100);

    // Metadata box
    doc.rect(50, 130, 495, 80).stroke('#cccccc');
    doc.fontSize(9).font('Helvetica-Bold').text('DC Number', 60, 140);
    doc.font('Helvetica').fontSize(12).text(displayNumber, 60, 153);
    doc.fontSize(9).font('Helvetica-Bold').text('Client', 220, 140);
    doc.font('Helvetica').fontSize(11).text(order.client.name, 220, 153);
    doc.fontSize(9).font('Helvetica-Bold').text('Delivered at', 400, 140);
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(
        (order.deliveredAt ?? order.updatedAt).toLocaleString('en-IN', {
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
    doc.fontSize(9).font('Helvetica-Bold').text('Ticket (iValue)', 60, 178);
    doc.font('Helvetica').text(order.ivalueTicketNumber ?? '—', 60, 191);
    doc.fontSize(9).font('Helvetica-Bold').text('Ticket (client)', 220, 178);
    doc.font('Helvetica').text(order.clientTicketNumber ?? '—', 220, 191);
    doc.fontSize(9).font('Helvetica-Bold').text('End user', 400, 178);
    doc.font('Helvetica').text(order.endUser?.name ?? '—', 400, 191);

    // Delivery details
    let cursorY = 222;
    doc.fontSize(9).font('Helvetica-Bold').text('Delivered to:', 50, cursorY);
    doc.font('Helvetica').text(`${order.contactName} · ${order.contactPhone}`, 155, cursorY);
    cursorY += 15;
    const addressLine = [address.street, address.city, address.state, address.pincode]
      .filter(Boolean)
      .join(', ');
    if (addressLine) {
      doc.fontSize(9).font('Helvetica-Bold').text('Address:', 50, cursorY);
      doc.font('Helvetica').text(addressLine, 155, cursorY, { width: 390 });
      cursorY += 15;
    }
    if (order.trackingNumber) {
      doc.fontSize(9).font('Helvetica-Bold').text('Tracking reference:', 50, cursorY);
      doc.font('Helvetica').text(order.trackingNumber, 155, cursorY);
      cursorY += 15;
    }

    // Asset details table
    const tableTop = cursorY + 10;
    doc.fontSize(10).font('Helvetica-Bold').text('Delivered asset', 50, tableTop);

    const tableStart = tableTop + 18;
    doc.rect(50, tableStart, 495, 20).fill('#1A2B3C');
    doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
    doc.text('Serial number', 55, tableStart + 6);
    doc.text('Asset tag', 210, tableStart + 6);
    doc.text('Model', 320, tableStart + 6);
    doc.text('Category', 440, tableStart + 6);
    doc.fillColor('#000000');

    const rowY = tableStart + 20;
    doc.rect(50, rowY, 495, 22).fill('#f8f8f8');
    doc.fillColor('#000000').font('Helvetica').fontSize(8);
    doc.text(order.asset.serialNumber, 55, rowY + 7, { width: 145 });
    doc.text(order.asset.assetTag ?? '—', 210, rowY + 7, { width: 100 });
    doc.text(`${order.asset.manufacturer} ${order.asset.model}`, 320, rowY + 7, {
      width: 115,
    });
    doc.text(order.asset.category, 440, rowY + 7);

    // Footer
    const footerY = Math.max(rowY + 60, 680);
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
