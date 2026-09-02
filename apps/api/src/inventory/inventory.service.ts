import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface InventoryFilter {
  clientId?: string;
  locationId?: string;
  status?: string;
  skip?: number;
  take?: number;
}

// US-INV-04 — buckets for the idle-stock ageing view.
const AGEING_BUCKETS = ['0-7', '8-30', '31-60', '61-90', '90+'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

function bucketFor(days: number): AgeingBucket {
  if (days <= 7) return '0-7';
  if (days <= 30) return '8-30';
  if (days <= 60) return '31-60';
  if (days <= 90) return '61-90';
  return '90+';
}

export interface AgeingRow {
  id: string;
  serialNumber: string;
  assetTag: string | null;
  model: string;
  manufacturer: string;
  category: string;
  clientId: string;
  clientName: string;
  daysIdle: number;
  bucket: AgeingBucket;
  idleSince: Date;
}

@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(filter: InventoryFilter): Promise<{ data: unknown[]; total: number }> {
    const where = {
      ...(filter.clientId ? { clientId: filter.clientId } : {}),
      ...(filter.locationId ? { currentLocationId: filter.locationId } : {}),
      ...(filter.status ? { currentStatus: filter.status as never } : {}),
    };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.asset.findMany({
        where,
        include: {
          currentLocation: true,
          disposalRequests: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { disposalType: true, certificateS3Key: true, status: true },
          },
          deploymentOrders: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: {
              dispatchedAt: true,
              deliveredAt: true,
              trackingNumber: true,
              courierName: true,
            },
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

  async summary(clientId?: string): Promise<Record<string, number>> {
    const statuses = [
      'receiving',
      'in_inspection',
      'in_storage',
      'deployed',
      'returning',
      'disposed',
    ] as const;

    const counts = await Promise.all(
      statuses.map((s) =>
        this.prisma.asset.count({
          where: { currentStatus: s, ...(clientId ? { clientId } : {}) },
        }),
      ),
    );

    return Object.fromEntries(statuses.map((s, i) => [s, counts[i]]));
  }

  /**
   * US-INV-04 — idle stock (in_storage assets), bucketed by how many days
   * each has sat there uninterrupted. "Idle since" is the most recent
   * transition into in_storage recorded in asset_status_history; assets that
   * entered in_storage before that table existed (2026-08-25) fall back to
   * asset.createdAt, same caveat as AssetStatusHistoryService.getDaysInStatus.
   */
  async ageing(filter: { clientId?: string; category?: string }): Promise<{
    buckets: Record<AgeingBucket, number>;
    rows: AgeingRow[];
  }> {
    const assets = await this.prisma.asset.findMany({
      where: {
        currentStatus: 'in_storage',
        ...(filter.clientId ? { clientId: filter.clientId } : {}),
        ...(filter.category ? { category: filter.category as never } : {}),
      },
      select: {
        id: true,
        serialNumber: true,
        assetTag: true,
        model: true,
        manufacturer: true,
        category: true,
        clientId: true,
        createdAt: true,
        client: { select: { name: true } },
      },
    });

    if (assets.length === 0) {
      return {
        buckets: Object.fromEntries(AGEING_BUCKETS.map((b) => [b, 0])) as Record<
          AgeingBucket,
          number
        >,
        rows: [],
      };
    }

    // Latest transition per asset — since currentStatus is in_storage, the
    // most recent history row for that asset (if any) is when it entered.
    const history = await this.prisma.assetStatusHistory.findMany({
      where: { assetId: { in: assets.map((a) => a.id) }, toStatus: 'in_storage' },
      select: { assetId: true, changedAt: true },
      orderBy: { changedAt: 'desc' },
    });
    const idleSinceByAsset = new Map<string, Date>();
    for (const h of history) {
      if (!idleSinceByAsset.has(h.assetId)) idleSinceByAsset.set(h.assetId, h.changedAt);
    }

    const now = Date.now();
    const buckets: Record<AgeingBucket, number> = {
      '0-7': 0,
      '8-30': 0,
      '31-60': 0,
      '61-90': 0,
      '90+': 0,
    };

    const rows: AgeingRow[] = assets.map((a) => {
      const idleSince = idleSinceByAsset.get(a.id) ?? a.createdAt;
      const daysIdle = Math.max(0, Math.floor((now - idleSince.getTime()) / (1000 * 60 * 60 * 24)));
      const bucket = bucketFor(daysIdle);
      buckets[bucket] += 1;
      return {
        id: a.id,
        serialNumber: a.serialNumber,
        assetTag: a.assetTag,
        model: a.model,
        manufacturer: a.manufacturer,
        category: a.category,
        clientId: a.clientId,
        clientName: a.client.name,
        daysIdle,
        bucket,
        idleSince,
      };
    });

    rows.sort((a, b) => b.daysIdle - a.daysIdle);

    return { buckets, rows };
  }
}
