import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { RateCardService } from '../rate-card/rate-card.service';
import { AuditService } from '../audit/audit.service';
import { CourierZoneService } from '../logistics/courier-zone.service';
import { AssetStatusHistoryService } from '../asset-status-history/asset-status-history.service';
import type { CreateRetrievalRequestDto } from './dto/create-retrieval-request.dto';
import type { UpdateRetrievalStatusDto } from './dto/update-retrieval-status.dto';

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

    const [retrievalRate, courierRate, wipeRate] = await Promise.all([
      this.rateCard.findEffectiveAt(retrievalCode, occurredAt),
      this.rateCard.findEffectiveAt(courierCode, occurredAt),
      dto.requiresWipe ? this.rateCard.findEffectiveAt('WIPE', occurredAt) : null,
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
          eventType: 'WIPE',
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
}
