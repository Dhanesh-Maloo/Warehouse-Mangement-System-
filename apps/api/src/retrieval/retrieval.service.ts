import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { RateCardService } from '../rate-card/rate-card.service';
import { AuditService } from '../audit/audit.service';
import type { CreateRetrievalRequestDto } from './dto/create-retrieval-request.dto';
import type { UpdateRetrievalStatusDto } from './dto/update-retrieval-status.dto';

@Injectable()
export class RetrievalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rateCard: RateCardService,
    private readonly audit: AuditService,
  ) {}

  findAll(
    clientId?: string,
  ): Prisma.PrismaPromise<Prisma.RetrievalRequestGetPayload<{ include: { asset: true } }>[]> {
    return this.prisma.retrievalRequest.findMany({
      where: clientId ? { clientId } : {},
      include: { asset: true },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async findOne(
    id: string,
  ): Promise<Prisma.RetrievalRequestGetPayload<{ include: { asset: true } }>> {
    const retrieval = await this.prisma.retrievalRequest.findUnique({
      where: { id },
      include: { asset: true },
    });
    if (!retrieval) throw new NotFoundException(`Retrieval request ${id} not found`);
    return retrieval;
  }

  async create(
    dto: CreateRetrievalRequestDto,
    createdByUserId: string,
  ): Promise<Prisma.RetrievalRequestGetPayload<{ include: { asset: true } }>> {
    const occurredAt = new Date();

    // Resolve retrieval rate code based on bundle type
    const retrievalCode = dto.bundleType === 'full_cycle' ? 'RETRIEVAL_FULL_CYCLE' : 'RETRIEVAL';

    // Resolve courier rate code based on zone
    const courierCodeMap: Record<string, string> = {
      intra_state: 'COURIER_CITY',
      inter_state: 'COURIER_INTERSTATE',
      rural: 'COURIER_RURAL',
    };
    const courierCode = courierCodeMap[dto.courierZone];

    const [retrievalRate, courierRate] = await Promise.all([
      this.rateCard.findEffectiveAt(retrievalCode, occurredAt),
      this.rateCard.findEffectiveAt(courierCode, occurredAt),
    ]);

    const retrievalUnitRate = retrievalRate ? retrievalRate.unitRatePaise : BigInt(0);
    const courierUnitRate = courierRate ? courierRate.unitRatePaise : BigInt(0);

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
          courierZone: dto.courierZone,
          requiresPostInspection: dto.requiresPostInspection,
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

      // Update asset status to 'returning'
      await tx.asset.update({
        where: { id: dto.assetId },
        data: { currentStatus: 'returning' },
      });

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

    const RETRIEVAL_TRANSITIONS: Record<string, string[]> = {
      pending: ['initiated', 'cancelled'],
      initiated: ['in_transit', 'cancelled'],
      in_transit: ['received', 'cancelled'],
      received: ['completed'],
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

      // When received: route asset based on whether post-inspection is required
      if (dto.status === 'received') {
        if (retrieval.requiresPostInspection) {
          await tx.asset.update({
            where: { id: retrieval.assetId },
            data: { currentStatus: 'in_inspection' },
          });
          await tx.inspection.create({
            data: {
              assetId: retrieval.assetId,
              type: 'outbound',
              startedAt: now,
              startedByUserId: retrieval.createdByUserId,
              status: 'in_progress',
            },
          });
        } else {
          await tx.asset.update({
            where: { id: retrieval.assetId },
            data: { currentStatus: 'in_storage' },
          });
        }
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
}
