import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { RateCardService } from '../rate-card/rate-card.service';

export interface ClientAccrualResult {
  clientId: string;
  clientName: string;
  laptopCount: number;
  peripheralCount: number;
  totalDeviceCount: number;
  laptopAmountPaise: bigint;
  peripheralAmountPaise: bigint;
  totalAmountPaise: bigint;
  minimumCommitmentMet: boolean;
  skipped: boolean;
  skipReason?: string;
}

export interface AccrualRunResult {
  periodStart: Date;
  periodEnd: Date;
  clientResults: ClientAccrualResult[];
  totalClients: number;
  clientsBelowCommitment: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rateCard: RateCardService,
  ) {}

  /**
   * Main monthly accrual job.
   * Counts all in_storage assets per client (laptop/monitor vs peripheral),
   * calculates storage fees, posts ledger events, and records the run.
   */
  async runMonthlyAccrual(): Promise<AccrualRunResult> {
    const now = new Date();
    // Period covers the current calendar month from the 1st up to today
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = now;

    this.logger.log(
      `Starting monthly storage accrual for period ${periodStart.toISOString().slice(0, 10)} → ${periodEnd.toISOString().slice(0, 10)}`,
    );

    const clients = await this.prisma.client.findMany({
      where: { isActive: true },
      select: { id: true, name: true, committedMonthlyAmountPaise: true },
    });

    const laptopRate = await this.rateCard.findEffectiveAt('STORAGE_LAPTOP', periodStart);
    const peripheralRate = await this.rateCard.findEffectiveAt('STORAGE_PERIPHERAL', periodStart);
    const laptopRatePaise = laptopRate ? laptopRate.unitRatePaise : BigInt(11400);
    const peripheralRatePaise = peripheralRate ? peripheralRate.unitRatePaise : BigInt(2800);

    const clientResults: ClientAccrualResult[] = [];

    for (const client of clients) {
      try {
        const result = await this.processClientAccrual(
          client.id,
          client.name,
          periodStart,
          periodEnd,
          now,
          laptopRatePaise,
          peripheralRatePaise,
          client.committedMonthlyAmountPaise,
        );
        clientResults.push(result);

        if (!result.minimumCommitmentMet && !result.skipped) {
          this.logger.warn(
            `Client ${client.name} (${client.id}) is below minimum commitment: ` +
              `charged ${result.totalAmountPaise} paise, minimum is ${client.committedMonthlyAmountPaise} paise`,
          );
        }
      } catch (err) {
        this.logger.error(`Failed to process accrual for client ${client.id}: ${String(err)}`);
        clientResults.push({
          clientId: client.id,
          clientName: client.name,
          laptopCount: 0,
          peripheralCount: 0,
          totalDeviceCount: 0,
          laptopAmountPaise: 0n,
          peripheralAmountPaise: 0n,
          totalAmountPaise: 0n,
          minimumCommitmentMet: false,
          skipped: true,
          skipReason: `Error: ${String(err)}`,
        });
      }
    }

    this.logger.log(`Monthly storage accrual complete. Processed ${clientResults.length} clients.`);

    return {
      periodStart,
      periodEnd,
      clientResults,
      totalClients: clientResults.length,
      clientsBelowCommitment: clientResults.filter((r) => !r.minimumCommitmentMet && !r.skipped)
        .length,
    };
  }

  /**
   * Process storage accrual for a single client.
   * Posts STORAGE_LAPTOP and STORAGE_PERIPHERAL ledger events, and records the run.
   */
  private async processClientAccrual(
    clientId: string,
    clientName: string,
    periodStart: Date,
    periodEnd: Date,
    occurredAt: Date,
    laptopRatePaise: bigint,
    peripheralRatePaise: bigint,
    committedMonthlyAmountPaise: bigint,
  ): Promise<ClientAccrualResult> {
    // Remove any existing accrual runs for the same calendar month to prevent duplicate charges
    const monthStart = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1);
    const monthEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0, 23, 59, 59);

    const existingRun = await this.prisma.storageAccrualRun.findFirst({
      where: { clientId, periodStart: { gte: monthStart, lte: monthEnd } },
      orderBy: { createdAt: 'desc' },
    });

    // Accrual for this month already completed — skip to preserve append-only ledger integrity.
    // A re-run would require reversal entries; for now return the recorded result.
    if (existingRun) {
      return {
        clientId,
        clientName,
        laptopCount: existingRun.laptopCount,
        peripheralCount: existingRun.peripheralCount,
        totalDeviceCount: existingRun.totalDeviceCount,
        laptopAmountPaise: existingRun.laptopAmountPaise,
        peripheralAmountPaise: existingRun.peripheralAmountPaise,
        totalAmountPaise: existingRun.totalAmountPaise,
        minimumCommitmentMet: existingRun.minimumCommitmentMet,
        skipped: true,
        skipReason: `Accrual for ${monthStart.toISOString().slice(0, 7)} already completed`,
      };
    }

    // Count laptops and monitors in storage
    const laptopCount = await this.prisma.asset.count({
      where: {
        clientId,
        currentStatus: 'in_storage',
        category: { in: ['laptop', 'monitor'] },
      },
    });

    // Count peripherals in storage
    const peripheralCount = await this.prisma.asset.count({
      where: {
        clientId,
        currentStatus: 'in_storage',
        category: 'peripheral',
      },
    });

    const laptopAmountPaise = BigInt(laptopCount) * laptopRatePaise;
    const peripheralAmountPaise = BigInt(peripheralCount) * peripheralRatePaise;
    const totalAmountPaise = laptopAmountPaise + peripheralAmountPaise;
    const minimumCommitmentMet = totalAmountPaise >= committedMonthlyAmountPaise;
    const totalDeviceCount = laptopCount + peripheralCount;

    if (totalDeviceCount === 0) {
      // Still record the run even if no devices, but skip ledger events
      await this.prisma.storageAccrualRun.create({
        data: {
          client: { connect: { id: clientId } },
          periodStart,
          periodEnd,
          laptopCount: 0,
          peripheralCount: 0,
          totalDeviceCount: 0,
          laptopAmountPaise: 0n,
          peripheralAmountPaise: 0n,
          totalAmountPaise: 0n,
          minimumCommitmentPaise: committedMonthlyAmountPaise,
          minimumCommitmentMet: false,
        },
      });

      return {
        clientId,
        clientName,
        laptopCount: 0,
        peripheralCount: 0,
        totalDeviceCount: 0,
        laptopAmountPaise: 0n,
        peripheralAmountPaise: 0n,
        totalAmountPaise: 0n,
        minimumCommitmentMet: false,
        skipped: true,
        skipReason: 'No devices in storage',
      };
    }

    // Post STORAGE_LAPTOP ledger event (one bulk row per client)
    if (laptopCount > 0) {
      // Find a representative asset to satisfy the EventLedger FK — use first laptop/monitor in storage
      const representativeAsset = await this.prisma.asset.findFirst({
        where: {
          clientId,
          currentStatus: 'in_storage',
          category: { in: ['laptop', 'monitor'] },
        },
        select: { id: true },
      });

      if (representativeAsset) {
        await this.ledger.create({
          eventType: 'STORAGE_LAPTOP',
          asset: { connect: { id: representativeAsset.id } },
          client: { connect: { id: clientId } },
          quantity: laptopCount,
          unitRatePaise: laptopRatePaise,
          amountPaise: laptopAmountPaise,
          occurredAt,
          createdBy: 'system:storage-accrual',
          referenceType: 'storage_accrual',
          notes: `Monthly storage accrual: ${laptopCount} laptop/monitor device(s) @ ₹${Number(laptopRatePaise) / 100}/device`,
        });
      }
    }

    // Post STORAGE_PERIPHERAL ledger event (one bulk row per client)
    if (peripheralCount > 0) {
      const representativePeripheral = await this.prisma.asset.findFirst({
        where: {
          clientId,
          currentStatus: 'in_storage',
          category: 'peripheral',
        },
        select: { id: true },
      });

      if (representativePeripheral) {
        await this.ledger.create({
          eventType: 'STORAGE_PERIPHERAL',
          asset: { connect: { id: representativePeripheral.id } },
          client: { connect: { id: clientId } },
          quantity: peripheralCount,
          unitRatePaise: peripheralRatePaise,
          amountPaise: peripheralAmountPaise,
          occurredAt,
          createdBy: 'system:storage-accrual',
          referenceType: 'storage_accrual',
          notes: `Monthly storage accrual: ${peripheralCount} peripheral device(s) @ ₹${Number(peripheralRatePaise) / 100}/device`,
        });
      }
    }

    // Post COMMITMENT_ADJUSTMENT if total is below minimum commitment
    if (!minimumCommitmentMet && totalDeviceCount > 0) {
      const shortfallPaise = committedMonthlyAmountPaise - totalAmountPaise;
      // Use the first available asset for the FK requirement
      const anyAsset = await this.prisma.asset.findFirst({
        where: { clientId, currentStatus: { in: ['in_storage', 'deployed', 'returning'] } },
        select: { id: true },
      });
      if (anyAsset) {
        await this.ledger.create({
          eventType: 'COMMITMENT_ADJUSTMENT',
          asset: { connect: { id: anyAsset.id } },
          client: { connect: { id: clientId } },
          quantity: 1,
          unitRatePaise: shortfallPaise,
          amountPaise: shortfallPaise,
          occurredAt,
          createdBy: 'system:storage-accrual',
          referenceType: 'storage_accrual',
          notes: `Minimum commitment adjustment: billed ${Number(totalAmountPaise) / 100} < minimum ${Number(committedMonthlyAmountPaise) / 100}`,
        });
      }
    }

    // Record the accrual run
    await this.prisma.storageAccrualRun.create({
      data: {
        client: { connect: { id: clientId } },
        periodStart,
        periodEnd,
        laptopCount,
        peripheralCount,
        totalDeviceCount,
        laptopAmountPaise,
        peripheralAmountPaise,
        totalAmountPaise,
        minimumCommitmentPaise: committedMonthlyAmountPaise,
        minimumCommitmentMet,
      },
    });

    return {
      clientId,
      clientName,
      laptopCount,
      peripheralCount,
      totalDeviceCount,
      laptopAmountPaise,
      peripheralAmountPaise,
      totalAmountPaise,
      minimumCommitmentMet,
      skipped: false,
    };
  }

  /**
   * Returns recent storage accrual run records, optionally filtered by client.
   */
  async getAccrualRuns(clientId?: string): Promise<
    import('@prisma/client').Prisma.StorageAccrualRunGetPayload<{
      include: { client: { select: { id: true; name: true; slug: true } } };
    }>[]
  > {
    return this.prisma.storageAccrualRun.findMany({
      where: clientId ? { clientId } : {},
      include: { client: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  /**
   * Returns current in-storage device counts and projected monthly cost for a client.
   */
  async getStorageSummary(clientId: string): Promise<{
    clientId: string;
    clientName: string | null;
    laptopCount: number;
    peripheralCount: number;
    laptopProjectedPaise: string;
    peripheralProjectedPaise: string;
    totalProjectedPaise: string;
    minimumCommitmentPaise: string;
    minimumCommitmentMet: boolean;
    shortfallPaise: string | null;
    rates: { laptopPerDevicePaise: string; peripheralPerDevicePaise: string };
    lastAccrualRun: {
      id: string;
      periodStart: Date;
      periodEnd: Date;
      totalAmountPaise: string;
      minimumCommitmentMet: boolean;
      createdAt: Date;
    } | null;
  }> {
    const [laptopCount, peripheralCount, client] = await Promise.all([
      this.prisma.asset.count({
        where: {
          clientId,
          currentStatus: 'in_storage',
          category: { in: ['laptop', 'monitor'] },
        },
      }),
      this.prisma.asset.count({
        where: {
          clientId,
          currentStatus: 'in_storage',
          category: 'peripheral',
        },
      }),
      this.prisma.client.findUnique({
        where: { id: clientId },
        select: { id: true, name: true, committedMonthlyAmountPaise: true },
      }),
    ]);

    const [laptopRate, peripheralRate] = await Promise.all([
      this.rateCard.findEffectiveAt('STORAGE_LAPTOP', new Date()),
      this.rateCard.findEffectiveAt('STORAGE_PERIPHERAL', new Date()),
    ]);
    const laptopRatePaise = laptopRate ? laptopRate.unitRatePaise : BigInt(11400);
    const peripheralRatePaise = peripheralRate ? peripheralRate.unitRatePaise : BigInt(2800);

    const laptopAmountPaise = BigInt(laptopCount) * laptopRatePaise;
    const peripheralAmountPaise = BigInt(peripheralCount) * peripheralRatePaise;
    const projectedTotalPaise = laptopAmountPaise + peripheralAmountPaise;
    const commitmentAmount = client?.committedMonthlyAmountPaise ?? BigInt(4275000);
    const minimumCommitmentMet = projectedTotalPaise >= commitmentAmount;

    // Last run for this client
    const lastRun = await this.prisma.storageAccrualRun.findFirst({
      where: { clientId },
      orderBy: { createdAt: 'desc' },
    });

    return {
      clientId,
      clientName: client?.name ?? null,
      laptopCount,
      peripheralCount,
      laptopProjectedPaise: laptopAmountPaise.toString(),
      peripheralProjectedPaise: peripheralAmountPaise.toString(),
      totalProjectedPaise: projectedTotalPaise.toString(),
      minimumCommitmentPaise: (client?.committedMonthlyAmountPaise ?? BigInt(4275000)).toString(),
      minimumCommitmentMet,
      shortfallPaise: minimumCommitmentMet
        ? null
        : (
            (client?.committedMonthlyAmountPaise ?? BigInt(4275000)) - projectedTotalPaise
          ).toString(),
      rates: {
        laptopPerDevicePaise: laptopRatePaise.toString(),
        peripheralPerDevicePaise: peripheralRatePaise.toString(),
      },
      lastAccrualRun: lastRun
        ? {
            id: lastRun.id,
            periodStart: lastRun.periodStart,
            periodEnd: lastRun.periodEnd,
            totalAmountPaise: lastRun.totalAmountPaise.toString(),
            minimumCommitmentMet: lastRun.minimumCommitmentMet,
            createdAt: lastRun.createdAt,
          }
        : null,
    };
  }
}
