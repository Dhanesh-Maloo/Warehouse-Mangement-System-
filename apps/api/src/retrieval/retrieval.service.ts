import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { RateCardService } from '../rate-card/rate-card.service';
import { AuditService } from '../audit/audit.service';
import { CourierZoneService } from '../logistics/courier-zone.service';
import { AssetStatusHistoryService } from '../asset-status-history/asset-status-history.service';
import type { CreateRetrievalRequestDto } from './dto/create-retrieval-request.dto';
import type { UpdateRetrievalStatusDto } from './dto/update-retrieval-status.dto';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit') as typeof import('pdfkit');

@Injectable()
export class RetrievalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rateCard: RateCardService,
    private readonly audit: AuditService,
    private readonly courierZone: CourierZoneService,
    private readonly assetStatusHistory: AssetStatusHistoryService,
  ) {}

  findAll(
    clientId?: string,
    filters?: {
      status?: string;
      ownerId?: string;
      fromDate?: string;
      toDate?: string;
      search?: string;
    },
  ): Prisma.PrismaPromise<
    Prisma.RetrievalRequestGetPayload<{
      include: { asset: true; createdByUser: { select: { id: true; fullName: true } } };
    }>[]
  > {
    const toDateFilter = filters?.toDate
      ? (() => {
          const d = new Date(filters.toDate as string);
          if (!(filters.toDate as string).includes('T')) d.setDate(d.getDate() + 1);
          return d;
        })()
      : null;

    // Broad search across asset identity, tickets, tracking, notes, and
    // owner name — not just ticket numbers.
    const searchFilter = filters?.search
      ? {
          OR: [
            { ivalueTicketNumber: { contains: filters.search, mode: 'insensitive' as const } },
            { clientTicketNumber: { contains: filters.search, mode: 'insensitive' as const } },
            { trackingNumber: { contains: filters.search, mode: 'insensitive' as const } },
            { notes: { contains: filters.search, mode: 'insensitive' as const } },
            {
              asset: {
                OR: [
                  { serialNumber: { contains: filters.search, mode: 'insensitive' as const } },
                  { model: { contains: filters.search, mode: 'insensitive' as const } },
                  { manufacturer: { contains: filters.search, mode: 'insensitive' as const } },
                  { assetTag: { contains: filters.search, mode: 'insensitive' as const } },
                ],
              },
            },
            {
              createdByUser: {
                fullName: { contains: filters.search, mode: 'insensitive' as const },
              },
            },
          ],
        }
      : {};

    return this.prisma.retrievalRequest.findMany({
      where: {
        ...(clientId ? { clientId } : {}),
        ...(filters?.status ? { status: filters.status as never } : {}),
        ...(filters?.ownerId ? { createdByUserId: filters.ownerId } : {}),
        ...(filters?.fromDate || toDateFilter
          ? {
              requestedAt: {
                ...(filters?.fromDate ? { gte: new Date(filters.fromDate) } : {}),
                ...(toDateFilter ? { lt: toDateFilter } : {}),
              },
            }
          : {}),
        ...searchFilter,
      },
      include: { asset: true, createdByUser: { select: { id: true, fullName: true } } },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async findOne(id: string): Promise<
    Prisma.RetrievalRequestGetPayload<{
      include: { asset: true; createdByUser: { select: { id: true; fullName: true } } };
    }>
  > {
    const retrieval = await this.prisma.retrievalRequest.findUnique({
      where: { id },
      include: { asset: true, createdByUser: { select: { id: true, fullName: true } } },
    });
    if (!retrieval) throw new NotFoundException(`Retrieval request ${id} not found`);
    return retrieval;
  }

  async create(
    dto: CreateRetrievalRequestDto,
    createdByUserId: string,
  ): Promise<Prisma.RetrievalRequestGetPayload<{ include: { asset: true } }>> {
    const asset = await this.prisma.asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new NotFoundException(`Asset ${dto.assetId} not found`);

    // createdByUserId doubles as the "owner" — the person credited with
    // handling this retrieval. Usually the logged-in user, but overridable
    // via dto.ownerId (see controller), so validate it explicitly here
    // rather than surfacing a raw FK-constraint error.
    const owner = await this.prisma.user.findUnique({ where: { id: createdByUserId } });
    if (!owner) throw new NotFoundException(`User ${createdByUserId} not found`);

    if (asset.clientId !== dto.clientId) {
      throw new BadRequestException(
        `Asset ${dto.assetId} does not belong to client ${dto.clientId}`,
      );
    }

    if (dto.requiresWipe && !dto.wipeType) {
      throw new BadRequestException(
        'wipeType (non_certified or certified_blanco) is required when requiresWipe is true',
      );
    }

    const occurredAt = new Date();

    // Resolve retrieval rate code based on bundle type
    const retrievalCode = dto.bundleType === 'full_cycle' ? 'RETRIEVAL_FULL_CYCLE' : 'RETRIEVAL';

    // Courier zone is derived server-side from the pickup pincode — never
    // trust a client-supplied zone for billing.
    const courierZone = await this.courierZone.resolveZone(dto.pickupAddress.pincode);
    const courierCodeMap: Record<string, string> = {
      intra_state: 'COURIER_CITY',
      inter_state: 'COURIER_INTERSTATE',
      rural: 'COURIER_RURAL',
    };
    const courierCode = courierCodeMap[courierZone];

    // Two billed wipe tiers, mirroring Disposal's non_certified/certified_blanco.
    const wipeCode =
      dto.wipeType === 'certified_blanco' ? 'RETRIEVAL_WIPE_CERTIFIED' : 'RETRIEVAL_WIPE_NON_CERT';

    const [retrievalRate, courierRate, wipeRate] = await Promise.all([
      this.rateCard.findEffectiveAt(retrievalCode, occurredAt),
      this.rateCard.findEffectiveAt(courierCode, occurredAt),
      dto.requiresWipe ? this.rateCard.findEffectiveAt(wipeCode, occurredAt) : null,
    ]);

    const retrievalUnitRate = retrievalRate ? retrievalRate.unitRatePaise : BigInt(0);
    const courierUnitRate = courierRate ? courierRate.unitRatePaise : BigInt(0);
    const wipeUnitRate = wipeRate ? wipeRate.unitRatePaise : BigInt(0);

    return this.prisma.$transaction(async (tx) => {
      const retrieval = await tx.retrievalRequest.create({
        data: {
          clientId: dto.clientId,
          assetId: dto.assetId,
          bundleType: dto.bundleType,
          pickupAddress:
            dto.pickupAddress as unknown as import('@prisma/client').Prisma.InputJsonValue,
          contactName: dto.contactName,
          contactPhone: dto.contactPhone,
          courierZone,
          requiresPostInspection: dto.requiresPostInspection,
          requiresWipe: dto.requiresWipe ?? false,
          wipeType: dto.requiresWipe ? dto.wipeType : undefined,
          requiresRedeploySetup: dto.requiresRedeploySetup ?? false,
          redeployEndUserId: dto.redeployEndUserId,
          redeployDeliveryAddress: dto.redeployDeliveryAddress
            ? (dto.redeployDeliveryAddress as unknown as import('@prisma/client').Prisma.InputJsonValue)
            : undefined,
          redeployContactName: dto.redeployContactName,
          redeployContactPhone: dto.redeployContactPhone,
          ivalueTicketNumber: dto.ivalueTicketNumber,
          clientTicketNumber: dto.clientTicketNumber,
          notes: dto.notes,
          createdByUserId,
        },
        include: { asset: true },
      });

      // Post retrieval ledger event
      await this.ledger.create({
        eventType: retrievalCode,
        asset: { connect: { id: dto.assetId } },
        client: { connect: { id: dto.clientId } },
        quantity: 1,
        unitRatePaise: retrievalUnitRate,
        amountPaise: retrievalUnitRate,
        occurredAt,
        createdBy: createdByUserId,
        referenceId: retrieval.id,
        referenceType: 'retrieval',
      });

      // Post return courier ledger event
      await this.ledger.create({
        eventType: courierCode,
        asset: { connect: { id: dto.assetId } },
        client: { connect: { id: dto.clientId } },
        quantity: 1,
        unitRatePaise: courierUnitRate,
        amountPaise: courierUnitRate,
        occurredAt,
        createdBy: createdByUserId,
        referenceId: retrieval.id,
        referenceType: 'retrieval',
      });

      // Post data wipe ledger event, if requested
      if (dto.requiresWipe) {
        await this.ledger.create({
          eventType: wipeCode,
          asset: { connect: { id: dto.assetId } },
          client: { connect: { id: dto.clientId } },
          quantity: 1,
          unitRatePaise: wipeUnitRate,
          amountPaise: wipeUnitRate,
          occurredAt,
          createdBy: createdByUserId,
          referenceId: retrieval.id,
          referenceType: 'retrieval',
        });
      }

      // Update asset status to 'returning'
      await tx.asset.update({
        where: { id: dto.assetId },
        data: { currentStatus: 'returning' },
      });
      await this.assetStatusHistory.record(
        {
          assetId: dto.assetId,
          clientId: dto.clientId,
          fromStatus: retrieval.asset.currentStatus,
          toStatus: 'returning',
          sourceModule: 'retrieval',
        },
        tx,
      );

      await this.audit.log({
        userId: createdByUserId,
        action: 'retrieval.create',
        entity: 'RetrievalRequest',
        entityId: retrieval.id,
        newValue: { assetId: dto.assetId, bundleType: dto.bundleType, status: 'pending' },
      });

      return retrieval;
    });
  }

  async updateStatus(
    id: string,
    dto: UpdateRetrievalStatusDto,
    updatedByUserId: string,
  ): Promise<Prisma.RetrievalRequestGetPayload<{ include: { asset: true } }>> {
    const retrieval = await this.findOne(id);

    // 'received' is the final manually-driven stage — a clean Full Cycle
    // retrieval is still auto-completed by the inspection outcome handler
    // (see InspectionsService.handleRetrievalDiagnosticOutcome), which updates
    // the record directly and does not go through this transition map.
    const RETRIEVAL_TRANSITIONS: Record<string, string[]> = {
      pending: ['initiated', 'cancelled'],
      initiated: ['in_transit', 'cancelled'],
      in_transit: ['received', 'cancelled'],
      received: [],
      completed: [],
      cancelled: [],
    };

    const allowed = RETRIEVAL_TRANSITIONS[retrieval.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition retrieval request from '${retrieval.status}' to '${dto.status}'`,
      );
    }

    const now = new Date();
    const timestamps: Record<string, Date> = {};
    if (dto.status === 'initiated') timestamps['initiatedAt'] = now;
    if (dto.status === 'received') timestamps['receivedAt'] = now;
    if (dto.status === 'completed') timestamps['completedAt'] = now;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.retrievalRequest.update({
        where: { id },
        data: {
          status: dto.status,
          ...(dto.trackingNumber !== undefined && { trackingNumber: dto.trackingNumber }),
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...timestamps,
        },
        include: { asset: true },
      });

      // When received: every retrieval (Standard and Full Cycle alike) now
      // goes through a diagnostic inspection before storage/redeploy — this
      // matches the confirmed SOP: device in -> inspect -> diagnostic check
      // -> alert on damage, or (Full Cycle only) proceed to redeploy.
      if (dto.status === 'received') {
        await tx.asset.update({
          where: { id: retrieval.assetId },
          data: { currentStatus: 'in_inspection' },
        });
        await this.assetStatusHistory.record(
          {
            assetId: retrieval.assetId,
            clientId: retrieval.clientId,
            fromStatus: retrieval.asset.currentStatus,
            toStatus: 'in_inspection',
            sourceModule: 'retrieval',
          },
          tx,
        );
        await tx.inspection.create({
          data: {
            assetId: retrieval.assetId,
            sourceRetrievalId: retrieval.id,
            type: 'outbound',
            startedAt: now,
            startedByUserId: retrieval.createdByUserId,
            status: 'in_progress',
          },
        });
      }

      await this.audit.log({
        userId: updatedByUserId,
        action: 'retrieval.updateStatus',
        entity: 'RetrievalRequest',
        entityId: id,
        oldValue: { status: retrieval.status },
        newValue: { status: dto.status, trackingNumber: dto.trackingNumber },
      });

      return updated;
    });
  }

  /** Manually correct the courier zone of a request (no ledger correction). */
  async updateZone(
    id: string,
    courierZone: 'intra_state' | 'inter_state' | 'rural',
    updatedByUserId: string,
  ): Promise<Prisma.RetrievalRequestGetPayload<{ include: { asset: true } }>> {
    const retrieval = await this.findOne(id);
    const updated = await this.prisma.retrievalRequest.update({
      where: { id },
      data: { courierZone },
      include: { asset: true },
    });
    await this.audit.log({
      userId: updatedByUserId,
      action: 'retrieval.updateZone',
      entity: 'RetrievalRequest',
      entityId: id,
      oldValue: { courierZone: retrieval.courierZone },
      newValue: { courierZone },
    });
    return updated;
  }

  findByAsset(
    assetId: string,
    clientId?: string,
  ): Prisma.PrismaPromise<Prisma.RetrievalRequestGetPayload<{ include: { asset: true } }>[]> {
    return this.prisma.retrievalRequest.findMany({
      where: clientId ? { assetId, clientId } : { assetId },
      include: { asset: true },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async updateTickets(
    id: string,
    dto: { ivalueTicketNumber?: string; clientTicketNumber?: string },
  ): Promise<Prisma.RetrievalRequestGetPayload<{ include: { asset: true } }>> {
    await this.findOne(id);
    return this.prisma.retrievalRequest.update({
      where: { id },
      data: {
        ivalueTicketNumber: dto.ivalueTicketNumber,
        clientTicketNumber: dto.clientTicketNumber,
      },
      include: { asset: true },
    });
  }

  /**
   * Confirmation document proving a specific asset has been physically
   * retrieved, for handoff to the client — mirrors Inbound's GRN, but for a
   * single-asset retrieval rather than a multi-device delivery batch.
   */
  async generateRetrievalPdf(
    id: string,
    requestingClientId?: string,
  ): Promise<{ stream: NodeJS.ReadableStream; filename: string }> {
    const retrieval = await this.prisma.retrievalRequest.findUnique({
      where: { id },
      include: {
        client: true,
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
    if (!retrieval) throw new NotFoundException(`Retrieval request ${id} not found`);
    if (requestingClientId && retrieval.clientId !== requestingClientId) {
      throw new ForbiddenException('Cannot download a retrieval confirmation from another client');
    }
    if (retrieval.status !== 'received' && retrieval.status !== 'completed') {
      throw new BadRequestException(
        'Retrieval confirmation is only available once the asset has been received back',
      );
    }

    const displayNumber = `RTRV-${retrieval.id.slice(-8).toUpperCase()}`;
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
      .text('Retrieval Confirmation', 50, 100);

    // Metadata box
    doc.rect(50, 130, 495, 80).stroke('#cccccc');
    doc.fontSize(9).font('Helvetica-Bold').text('Reference', 60, 140);
    doc.font('Helvetica').fontSize(12).text(displayNumber, 60, 153);
    doc.fontSize(9).font('Helvetica-Bold').text('Client', 220, 140);
    doc.font('Helvetica').fontSize(11).text(retrieval.client.name, 220, 153);
    doc.fontSize(9).font('Helvetica-Bold').text('Received at', 400, 140);
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(
        (retrieval.receivedAt ?? retrieval.updatedAt).toLocaleString('en-IN', {
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
    doc.font('Helvetica').text(retrieval.ivalueTicketNumber ?? '—', 60, 191);
    doc.fontSize(9).font('Helvetica-Bold').text('Ticket (client)', 220, 178);
    doc.font('Helvetica').text(retrieval.clientTicketNumber ?? '—', 220, 191);
    doc.fontSize(9).font('Helvetica-Bold').text('Owner', 400, 178);
    doc.font('Helvetica').text(retrieval.createdByUser.fullName, 400, 191);

    if (retrieval.trackingNumber) {
      doc.fontSize(9).font('Helvetica-Bold').text('Tracking reference:', 50, 222);
      doc.font('Helvetica').text(retrieval.trackingNumber, 155, 222);
    }

    // Asset details table
    const tableTop = retrieval.trackingNumber ? 245 : 228;
    doc.fontSize(10).font('Helvetica-Bold').text('Retrieved asset', 50, tableTop);

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
    doc.text(retrieval.asset.serialNumber, 55, rowY + 7, { width: 145 });
    doc.text(retrieval.asset.assetTag ?? '—', 210, rowY + 7, { width: 100 });
    doc.text(`${retrieval.asset.manufacturer} ${retrieval.asset.model}`, 320, rowY + 7, {
      width: 115,
    });
    doc.text(retrieval.asset.category, 440, rowY + 7);

    if (retrieval.damageFound !== null) {
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .text('Diagnostic result:', 50, rowY + 40);
      doc
        .font('Helvetica')
        .text(retrieval.damageFound ? 'Damage found' : 'No damage found', 155, rowY + 40);
    }

    // Footer
    const footerY = Math.max(rowY + 90, 680);
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
