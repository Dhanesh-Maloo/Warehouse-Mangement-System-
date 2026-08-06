import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { RepairRequest } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { RateCardService } from '../rate-card/rate-card.service';
import { AuditService } from '../audit/audit.service';
import { addBusinessMinutes } from '../common/business-hours.util';
import type { CreateRepairRequestDto } from './dto/create-repair-request.dto';
import type { UpdateRepairStatusDto } from './dto/update-repair-status.dto';
import type { UpdateRepairSlaDto } from './dto/update-repair-sla.dto';

export interface RepairAssetSummary {
  id: string;
  serialNumber: string;
  model: string;
  manufacturer: string;
}

export type RepairRequestWithAsset = RepairRequest & {
  asset: RepairAssetSummary | null;
  isOverdue: boolean;
};

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

const REPAIR_TERMINAL_STATUSES = new Set(['completed', 'cancelled']);

// Repair SLA policy (clarified with Divya, 2026-08-06):
//  - oem_warranty: turnaround is entirely on the OEM's own timeline. No fixed
//    internal SLA — slaTargetAt stays unset until staff enter the OEM's
//    committed date (at creation or via updateSla once it's known).
//  - in_house + software: fixed internal SLA of 3 business days (9 business
//    hours/day, per CLAUDE.md rule 4 — Mon-Sat 09:00-18:00 IST, excl. holidays).
//  - in_house + hardware: no fixed default — completion depends on parts
//    availability from the OEM/supplier, so slaTargetAt stays unset until
//    staff enter/update an estimate once parts availability is known.
// All of the above can be overridden with an explicit slaTargetAt at creation,
// and revised later at any point via updateSla.
const SOFTWARE_REPAIR_SLA_BUSINESS_MINUTES = 3 * 9 * 60;

@Injectable()
export class RepairService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rateCard: RateCardService,
    private readonly audit: AuditService,
  ) {}

  // Holiday calendar lookup is not wired up yet (see Holiday model) — mirrors
  // the same stub used by InspectionsService until that's implemented.
  private getHolidaySet(): Set<string> {
    return new Set<string>();
  }

  private isOverdue(repair: Pick<RepairRequest, 'status' | 'slaTargetAt'>): boolean {
    if (REPAIR_TERMINAL_STATUSES.has(repair.status)) return false;
    if (!repair.slaTargetAt) return false;
    return repair.slaTargetAt.getTime() < Date.now();
  }

  private async attachAssets(rows: RepairRequest[]): Promise<RepairRequestWithAsset[]> {
    if (rows.length === 0) return [];
    const assetIds = [...new Set(rows.map((r) => r.assetId))];
    const assets = await this.prisma.asset.findMany({
      where: { id: { in: assetIds } },
      select: { id: true, serialNumber: true, model: true, manufacturer: true },
    });
    const byId = new Map(assets.map((a) => [a.id, a]));
    return rows.map((r) => ({
      ...r,
      asset: byId.get(r.assetId) ?? null,
      isOverdue: this.isOverdue(r),
    }));
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

    if (dto.repairType === 'in_house' && !dto.repairCategory) {
      throw new BadRequestException(
        'repairCategory (software or hardware) is required for in_house repairs',
      );
    }

    const occurredAt = new Date();
    const rate = await this.rateCard.findEffectiveAt('REPAIR', occurredAt);
    const unitRate = rate ? rate.unitRatePaise : BigInt(0);

    const slaTargetAt = dto.slaTargetAt
      ? new Date(dto.slaTargetAt)
      : dto.repairType === 'in_house' && dto.repairCategory === 'software'
        ? addBusinessMinutes(occurredAt, SOFTWARE_REPAIR_SLA_BUSINESS_MINUTES, this.getHolidaySet())
        : null; // oem_warranty and in_house/hardware: no fixed default, set once known

    const repair = await this.prisma.$transaction(async (tx) => {
      const created = await tx.repairRequest.create({
        data: {
          clientId: dto.clientId,
          assetId: dto.assetId,
          serviceCenterName: dto.serviceCenterName,
          estimateCostPaise:
            dto.estimateCostPaise !== undefined ? BigInt(dto.estimateCostPaise) : undefined,
          repairType: dto.repairType,
          repairCategory: dto.repairType === 'in_house' ? dto.repairCategory : undefined,
          slaTargetAt,
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

  // Revises the SLA target after creation — e.g. an OEM finally confirms a
  // completion date, or an in-house hardware repair's parts ETA becomes known.
  async updateSla(
    id: string,
    dto: UpdateRepairSlaDto,
    updatedByUserId: string,
  ): Promise<RepairRequestWithAsset> {
    const repair = await this.prisma.repairRequest.findUnique({ where: { id } });
    if (!repair) throw new NotFoundException(`Repair request ${id} not found`);

    if (REPAIR_TERMINAL_STATUSES.has(repair.status)) {
      throw new BadRequestException(
        `Cannot update SLA target on a repair request that is already '${repair.status}'`,
      );
    }

    const slaTargetAt = new Date(dto.slaTargetAt);
    const now = new Date();

    const updated = await this.prisma.repairRequest.update({
      where: { id },
      data: { slaTargetAt, slaUpdatedAt: now },
    });

    await this.audit.log({
      userId: updatedByUserId,
      action: 'repair.updateSla',
      entity: 'RepairRequest',
      entityId: id,
      oldValue: { slaTargetAt: repair.slaTargetAt },
      newValue: { slaTargetAt, reason: dto.reason },
    });

    const [withAsset] = await this.attachAssets([updated]);
    return withAsset;
  }
}
