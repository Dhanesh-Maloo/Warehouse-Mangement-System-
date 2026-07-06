import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { RepairRequest } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { RateCardService } from '../rate-card/rate-card.service';
import { AuditService } from '../audit/audit.service';
import type { CreateRepairRequestDto } from './dto/create-repair-request.dto';
import type { UpdateRepairStatusDto } from './dto/update-repair-status.dto';

export interface RepairAssetSummary {
  id: string;
  serialNumber: string;
  model: string;
  manufacturer: string;
}

export type RepairRequestWithAsset = RepairRequest & { asset: RepairAssetSummary | null };

// RepairRequest has no Prisma relation to Asset — it's a plain FK column, not a
// relation field — so the related asset is looked up separately (batched by id)
// and attached in-memory, same pattern used for other relation-less lookups
// (e.g. EventSuppression) elsewhere in the codebase.
const REPAIR_TRANSITIONS: Record<string, string[]> = {
  pending: ['sent', 'cancelled'],
  sent: ['in_repair', 'cancelled'],
  in_repair: ['returned', 'cancelled'],
  returned: ['completed'],
  completed: [],
  cancelled: [],
};

@Injectable()
export class RepairService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rateCard: RateCardService,
    private readonly audit: AuditService,
  ) {}

  private async attachAssets(rows: RepairRequest[]): Promise<RepairRequestWithAsset[]> {
    if (rows.length === 0) return [];
    const assetIds = [...new Set(rows.map((r) => r.assetId))];
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: { id: true, serialNumber: true, model: true, manufacturer: true },
    });
    const byId = new Map(assets.map((a) => [a.id, a]));
    return rows.map((r) => ({ ...r, asset: byId.get(r.assetId) ?? null }));
  }

  async findAll(clientId?: string): Promise<RepairRequestWithAsset[]> {
    const rows = await this.prisma.repairRequest.findMany({
      where: clientId ? { clientId } : {},
      orderBy: { requestedAt: 'desc' },
    });
    return this.attachAssets(rows);
  }

  async findOne(id: string): Promise<RepairRequestWithAsset> {
    const repair = await this.prisma.repairRequest.findUnique({ where: { id } });
    if (!repair) throw new NotFoundException(`Repair request ${id} not found`);
    const [withAsset] = await this.attachAssets([repair]);
    return withAsset;
  }

  async findByAsset(assetId: string, clientId?: string): Promise<RepairRequestWithAsset[]> {
    const rows = await this.prisma.repairRequest.findMany({
      where: clientId ? { assetId, clientId } : { assetId },
      orderBy: { requestedAt: 'desc' },
    });
    return this.attachAssets(rows);
  }

  async create(
    dto: CreateRepairRequestDto,
    createdByUserId: string,
  ): Promise<RepairRequestWithAsset> {
    const asset = await this.prisma.asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new NotFoundException(`Asset ${dto.assetId} not found`);

    if (asset.clientId !== dto.clientId) {
      throw new BadRequestException(
        `Asset ${dto.assetId} does not belong to client ${dto.clientId}`,
      );
    }

    if (asset.currentStatus !== 'in_storage') {
      throw new BadRequestException(
        `Asset ${dto.assetId} must be in_storage to request repair (current status: ${asset.currentStatus})`,
      );
    }

    const occurredAt = new Date();
    const rate = await this.rateCard.findEffectiveAt('REPAIR', occurredAt);
    const unitRate = rate ? rate.unitRatePaise : BigInt(0);

    const repair = await this.prisma.$transaction(async (tx) => {
      const created = await tx.repairRequest.create({
        data: {
          clientId: dto.clientId,
          assetId: dto.assetId,
          serviceCenterName: dto.serviceCenterName,
          estimateCostPaise:
            dto.estimateCostPaise !== undefined ? BigInt(dto.estimateCostPaise) : undefined,
          notes: dto.notes,
          status: 'pending',
          createdByUserId,
        },
      });

      await tx.asset.update({
        where: { id: dto.assetId },
        data: { currentStatus: 'in_repair' },
      });

      return created;
    });

    await this.ledger.create({
      eventType: 'REPAIR',
      asset: { connect: { id: dto.assetId } },
      client: { connect: { id: dto.clientId } },
      quantity: 1,
      unitRatePaise: unitRate,
      amountPaise: unitRate,
      occurredAt,
      createdBy: createdByUserId,
      referenceId: repair.id,
      referenceType: 'repair',
    });

    await this.audit.log({
      userId: createdByUserId,
      action: 'repair.create',
      entity: 'RepairRequest',
      entityId: repair.id,
      newValue: {
        assetId: dto.assetId,
        serviceCenterName: dto.serviceCenterName,
        status: 'pending',
      },
    });

    const [withAsset] = await this.attachAssets([repair]);
    return withAsset;
  }

  async updateStatus(
    id: string,
    dto: UpdateRepairStatusDto,
    updatedByUserId: string,
  ): Promise<RepairRequestWithAsset> {
    const repair = await this.prisma.repairRequest.findUnique({ where: { id } });
    if (!repair) throw new NotFoundException(`Repair request ${id} not found`);

    const allowed = REPAIR_TRANSITIONS[repair.status] ?? [];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition repair request from '${repair.status}' to '${dto.status}'`,
      );
    }

    const now = new Date();
    const timestamps: Record<string, Date> = {};
    if (dto.status === 'sent') timestamps['sentAt'] = now;
    if (dto.status === 'returned') timestamps['returnedAt'] = now;
    if (dto.status === 'completed') timestamps['completedAt'] = now;

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.repairRequest.update({
        where: { id },
        data: {
          status: dto.status,
          ...(dto.notes !== undefined && { notes: dto.notes }),
          ...timestamps,
        },
      });

      // Returned: repair is done, asset goes back into storage.
      // Cancelled: repair never happened, asset also reverts to storage.
      if (dto.status === 'returned' || dto.status === 'cancelled') {
        await tx.asset.update({
          where: { id: repair.assetId },
          data: { currentStatus: 'in_storage' },
        });
      }

      return result;
    });

    await this.audit.log({
      userId: updatedByUserId,
      action: 'repair.updateStatus',
      entity: 'RepairRequest',
      entityId: id,
      oldValue: { status: repair.status },
      newValue: { status: dto.status },
    });

    const [withAsset] = await this.attachAssets([updated]);
    return withAsset;
  }
}
