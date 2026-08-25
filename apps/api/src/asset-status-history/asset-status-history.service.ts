import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { AssetStatus, AssetStatusHistory, Prisma } from '@prisma/client';

type PrismaTx = Prisma.TransactionClient | PrismaService;

/**
 * Records one row per Asset.currentStatus transition. Never edited or deleted —
 * this is the source of truth for "how long was this asset in a given status"
 * (e.g. days in in_storage during a billing month), which nothing else in the
 * system tracks. Call `record` in the same transaction as the Asset update
 * whenever currentStatus changes, passing the status the asset had *before*
 * the update (fromStatus is null only for a brand-new asset).
 */
@Injectable()
export class AssetStatusHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    params: {
      assetId: string;
      clientId: string;
      fromStatus: AssetStatus | null;
      toStatus: AssetStatus;
      sourceModule: string;
    },
    tx: PrismaTx = this.prisma,
  ): Promise<AssetStatusHistory> {
    return tx.assetStatusHistory.create({
      data: {
        asset: { connect: { id: params.assetId } },
        client: { connect: { id: params.clientId } },
        fromStatus: params.fromStatus,
        toStatus: params.toStatus,
        sourceModule: params.sourceModule,
      },
    });
  }

  /**
   * Days an asset spent in `status`, clipped to [periodStart, periodEnd).
   * Walks the asset's history in order, treating each row as "asset was in
   * toStatus from changedAt until the next row's changedAt (or periodEnd if
   * it's still the current status)". Only reflects transitions recorded after
   * this table was introduced (2026-08-25) — assets that entered the status
   * before then have no earlier boundary to measure from.
   */
  async getDaysInStatus(
    assetId: string,
    status: AssetStatus,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<number> {
    const history = await this.prisma.assetStatusHistory.findMany({
      where: { assetId },
      orderBy: { changedAt: 'asc' },
    });

    let msInStatus = 0;
    for (let i = 0; i < history.length; i++) {
      const row = history[i];
      if (row.toStatus !== status) continue;

      const intervalStart = row.changedAt;
      const intervalEnd = history[i + 1]?.changedAt ?? periodEnd;

      const clippedStart = intervalStart > periodStart ? intervalStart : periodStart;
      const clippedEnd = intervalEnd < periodEnd ? intervalEnd : periodEnd;

      if (clippedEnd > clippedStart) {
        msInStatus += clippedEnd.getTime() - clippedStart.getTime();
      }
    }

    return Math.round((msInStatus / (1000 * 60 * 60 * 24)) * 100) / 100;
  }
}
