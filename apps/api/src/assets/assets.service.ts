import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type {
  Asset,
  AssetCategory,
  AssetStatus,
  AssetCondition,
  ConditionGrade,
  Prisma,
  DisposalRequest,
  DeploymentOrder,
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
  constructor(private readonly prisma: PrismaService) {}

  async findAll(
    filter: AssetFilter,
  ): Promise<{ data: (Asset & { disposalRequests: Pick<DisposalRequest, 'disposalType' | 'certificateS3Key' | 'status'>[]; deploymentOrders: Pick<DeploymentOrder, 'dispatchedAt' | 'deliveredAt' | 'trackingNumber' | 'courierName'>[]; currentLocation: { id: string; name: string } | null })[]; total: number }> {
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
            select: { dispatchedAt: true, deliveredAt: true, trackingNumber: true, courierName: true },
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
    await this.findOne(id);
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
    return this.prisma.asset.update({ where: { id }, data: updateData });
  }

  async create(data: {
    serialNumber: string;
    assetTag?: string;
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
    return this.prisma.asset.create({
      data: { ...rest, ...(deliveredAt ? { deliveredAt: new Date(deliveredAt) } : {}) },
    });
  }
}
