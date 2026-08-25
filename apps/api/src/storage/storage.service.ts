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
  skipped: boolean;
  skipReason?: string;
}

export interface AccrualRunResult {
  periodStart: Date;
  periodEnd: Date;
  clientResults: ClientAccrualResult[];
  totalClients: number;
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
      select: { id: true, name: true },
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
        );
        clientResults.push(result);
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
  ): Promise<ClientAccrualResult> {
    // Find any existing run for this calendar month so we can reverse its ledger entries before re-posting
    const monthStart = new Date(periodStart.getFullYear(), periodStart.getMonth(), 1);
    const monthEnd = new Date(periodStart.getFullYear(), periodStart.getMonth() + 1, 0, 23, 59, 59);

    const existingRun = await this.prisma.storageAccrualRun.findFirst({
      where: { clientId, periodStart: { gte: monthStart, lte: monthEnd } },
      orderBy: { createdAt: 'desc' },
    });

    // If a run already exists for this month, reverse its ledger entries first so we
    // can post fresh ones with the current device count. This keeps the ledger append-only
    // while ensuring the month's storage charge always reflects live inventory.
    if (existingRun) {
      if (existingRun.laptopAmountPaise > 0n) {
        const representativeAsset = await this.prisma.asset.findFirst({
          where: { clientId, category: { in: ['laptop', 'monitor'] } },
          select: { id: true },
        });
        if (representativeAsset) {
          await this.ledger.create({
            eventType: 'STORAGE_LAPTOP',
            asset: { connect: { id: representativeAsset.id } },
            client: { connect: { id: clientId } },
            quantity: -existingRun.laptopCount,
            unitRatePaise: laptopRatePaise,
            amountPaise: -existingRun.laptopAmountPaise,
            occurredAt,
            createdBy: 'system:storage-accrual',
            referenceId: existingRun.id,
            referenceType: 'storage_accrual_reversal',
            notes: `Reversal of previous June laptop storage charge (${existingRun.laptopCount} devices)`,
          });
        }
      }
      if (existingRun.peripheralAmountPaise > 0n) {
        const representativePeripheral = await this.prisma.asset.findFirst({
          where: { clientId, category: 'peripheral' },
          select: { id: true },
        });
        if (representativePeripheral) {
          await this.ledger.create({
            eventType: 'STORAGE_PERIPHERAL',
            asset: { connect: { id: representativePeripheral.id } },
            client: { connect: { id: clientId } },
            quantity: -existingRun.peripheralCount,
            unitRatePaise: peripheralRatePaise,
            amountPaise: -existingRun.peripheralAmountPaise,
            occurredAt,
            createdBy: 'system:storage-accrual',
            referenceId: existingRun.id,
            referenceType: 'storage_accrual_reversal',
            notes: `Reversal of previous June peripheral storage charge (${existingRun.peripheralCount} devices)`,
          });
        }
      }
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
    rates: { laptopPerDevicePaise: string; peripheralPerDevicePaise: string };
    lastAccrualRun: {
      id: string;
      periodStart: Date;
      periodEnd: Date;
      totalAmountPaise: string;
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
        select: { id: true, name: true },
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
            createdAt: lastRun.createdAt,
          }
        : null,
    };
  }
}
