import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AssetStatusHistoryService } from '../asset-status-history/asset-status-history.service';
import { LedgerService } from '../ledger/ledger.service';
import type {
  Asset,
  AssetCategory,
  AssetStatus,
  AssetCondition,
  ConditionGrade,
  Prisma,
  DisposalRequest,
  DeploymentOrder,
  EventLedger,
} from '@prisma/client';

export interface AssetFilter {
  clientId?: string;
  category?: AssetCategory;
  currentStatus?: AssetStatus;
  conditionGrade?: ConditionGrade;
  currentLocationId?: string;
  search?: string;
  skip?: number;
  take?: number;
}

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assetStatusHistory: AssetStatusHistoryService,
    private readonly ledger: LedgerService,
  ) {}

  async findAll(filter: AssetFilter): Promise<{
    data: (Asset & {
      disposalRequests: Pick<DisposalRequest, 'disposalType' | 'certificateS3Key' | 'status'>[];
      deploymentOrders: Pick<
        DeploymentOrder,
        'dispatchedAt' | 'deliveredAt' | 'trackingNumber' | 'courierName'
      >[];
      currentLocation: { id: string; name: string } | null;
    })[];
    total: number;
  }> {
    const where = {
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.currentStatus ? { currentStatus: filter.currentStatus } : {}),
      ...(filter.conditionGrade ? { conditionGrade: filter.conditionGrade } : {}),
      ...(filter.currentLocationId ? { currentLocationId: filter.currentLocationId } : {}),
      ...(filter.search
        ? {
            OR: [
              { serialNumber: { contains: filter.search, mode: 'insensitive' as const } },
              { assetTag: { contains: filter.search, mode: 'insensitive' as const } },
              { referenceName: { contains: filter.search, mode: 'insensitive' as const } },
              { vendorName: { contains: filter.search, mode: 'insensitive' as const } },
              { model: { contains: filter.search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({
        where,
        include: {
          currentLocation: true,
          disposalRequests: {
            select: { disposalType: true, certificateS3Key: true, status: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
          deploymentOrders: {
            select: {
              dispatchedAt: true,
              deliveredAt: true,
              trackingNumber: true,
              courierName: true,
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { updatedAt: 'desc' },
        skip: filter.skip ?? 0,
        take: filter.take ?? 50,
      }),
      this.prisma.asset.count({ where }),
    ]);

    return { data, total };
  }

  async findOne(id: string): Promise<Asset & { inspections: unknown[]; ledgerEntries: unknown[] }> {
    const asset = await this.prisma.asset.findUnique({
      where: { id },
      include: {
        currentLocation: true,
        inspections: { include: { photos: true }, orderBy: { startedAt: 'desc' } },
        ledgerEntries: { orderBy: { occurredAt: 'desc' } },
      },
    });
    if (!asset) throw new NotFoundException(`Asset ${id} not found`);
    return asset;
  }

  async findBySerial(serialNumber: string): Promise<Asset | null> {
    return this.prisma.asset.findUnique({ where: { serialNumber } });
  }

  async checkSerialUnique(serialNumber: string): Promise<boolean> {
    const existing = await this.findBySerial(serialNumber);
    return existing === null;
  }

  async moveLocation(id: string, locationId: string): Promise<Asset> {
    await this.findOne(id);
    const location = await this.prisma.location.findUnique({ where: { id: locationId } });
    if (!location) throw new NotFoundException(`Location ${locationId} not found`);
    return this.prisma.asset.update({
      where: { id },
      data: { currentLocationId: locationId },
    });
  }

  async updateStatus(
    id: string,
    data: {
      currentStatus?: AssetStatus;
      currentLocationId?: string | null;
      conditionGrade?: ConditionGrade;
      serialNumber?: string;
      assetTag?: string;
      referenceName?: string;
      vendorName?: string;
      model?: string;
      manufacturer?: string;
      category?: string;
      assetCondition?: AssetCondition;
      repairHandling?: boolean;
      repairServiceName?: string;
      repairEstimateCost?: number;
      awbNumber?: string;
      courierName?: string;
      deliveredAt?: string;
      disposalType?: string;
      hasCertification?: boolean;
    },
  ): Promise<Asset> {
    const existing = await this.findOne(id);
    const { currentLocationId, category, deliveredAt, ...rest } = data;
    const updateData: Prisma.AssetUpdateInput = {
      ...rest,
      ...(category ? { category: category as AssetCategory } : {}),
      ...(deliveredAt ? { deliveredAt: new Date(deliveredAt) } : {}),
      ...(currentLocationId !== undefined
        ? {
            currentLocation: currentLocationId
              ? { connect: { id: currentLocationId } }
              : { disconnect: true },
          }
        : {}),
    };
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.asset.update({ where: { id }, data: updateData });
      if (data.currentStatus && data.currentStatus !== existing.currentStatus) {
        await this.assetStatusHistory.record(
          {
            assetId: id,
            clientId: existing.clientId,
            fromStatus: existing.currentStatus,
            toStatus: data.currentStatus,
            sourceModule: 'assets',
          },
          tx,
        );
      }
      return updated;
    });
  }

  async create(data: {
    serialNumber: string;
    assetTag?: string;
    referenceName?: string;
    vendorName?: string;
    model: string;
    manufacturer: string;
    category: AssetCategory;
    clientId: string;
    currentLocationId?: string;
    conditionGrade?: ConditionGrade;
    assetCondition?: AssetCondition;
    currentStatus?: AssetStatus;
    repairHandling?: boolean;
    repairServiceName?: string;
    repairEstimateCost?: number;
    awbNumber?: string;
    courierName?: string;
    deliveredAt?: string;
    disposalType?: string;
    hasCertification?: boolean;
  }): Promise<Asset> {
    const existing = await this.findBySerial(data.serialNumber);
    if (existing) throw new ConflictException(`Serial number ${data.serialNumber} already exists`);
    const { deliveredAt, ...rest } = data;
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.asset.create({
        data: { ...rest, ...(deliveredAt ? { deliveredAt: new Date(deliveredAt) } : {}) },
      });
      await this.assetStatusHistory.record(
        {
          assetId: asset.id,
          clientId: asset.clientId,
          fromStatus: null,
          toStatus: asset.currentStatus,
          sourceModule: 'assets',
        },
        tx,
      );
      return asset;
    });
  }

  /**
   * Everything billing-relevant for one asset over one calendar month:
   * every ledger charge against it (what was done, what it cost) plus how
   * many days it spent in_storage during that month. Days-in-storage only
   * reflects transitions recorded since asset_status_history was introduced
   * (2026-08-25) — it undercounts for assets whose storage period started
   * earlier and has no recorded entry event.
   */
  async getBillingSummary(
    id: string,
    month: string,
  ): Promise<{
    asset: Pick<
      Asset,
      'id' | 'serialNumber' | 'assetTag' | 'model' | 'manufacturer' | 'category' | 'currentStatus'
    >;
    month: string;
    periodStart: Date;
    periodEnd: Date;
    daysInStorage: number;
    totalChargesPaise: string;
    ledgerEntries: EventLedger[];
  }> {
    const asset = await this.findOne(id);

    const [yearStr, monthStr] = month.split('-');
    const year = Number(yearStr);
    const monthIndex = Number(monthStr) - 1;
    if (
      !Number.isInteger(year) ||
      !Number.isInteger(monthIndex) ||
      monthIndex < 0 ||
      monthIndex > 11
    ) {
      throw new NotFoundException(`Invalid month '${month}', expected format YYYY-MM`);
    }
    const periodStart = new Date(year, monthIndex, 1);
    const now = new Date();
    const periodEnd =
      new Date(year, monthIndex + 1, 1) < now ? new Date(year, monthIndex + 1, 1) : now;

    const [ledgerEntries, daysInStorage] = await Promise.all([
      this.ledger.findMany({
        where: { assetId: id, occurredAt: { gte: periodStart, lt: periodEnd } },
        orderBy: { occurredAt: 'desc' },
      }),
      this.assetStatusHistory.getDaysInStatus(id, 'in_storage', periodStart, periodEnd),
    ]);

    const totalChargesPaise = ledgerEntries.reduce((sum, e) => sum + e.amountPaise, BigInt(0));

    return {
      asset: {
        id: asset.id,
        serialNumber: asset.serialNumber,
        assetTag: asset.assetTag,
        model: asset.model,
        manufacturer: asset.manufacturer,
        category: asset.category,
        currentStatus: asset.currentStatus,
      },
      month,
      periodStart,
      periodEnd,
      daysInStorage,
      totalChargesPaise: totalChargesPaise.toString(),
      ledgerEntries,
    };
  }
}
