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
  commitmentAmountPaise: bigint;
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
          commitmentAmountPaise: 0n,
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

    // A representative asset (any status) to satisfy the EventLedger FK for a
    // client-level flat commitment charge that isn't tied to a specific device.
    const findRepresentativeAsset = (): Promise<{ id: string } | null> =>
      this.prisma.asset.findFirst({ where: { clientId }, select: { id: true } });

    // If a run already exists for this month, reverse its ledger entries first so we
    // can post fresh ones with the current device count. This keeps the ledger append-only
    // while ensuring the month's storage charge always reflects live inventory.
    if (existingRun) {
      const reversedMonthLabel = existingRun.periodStart.toLocaleString('en-IN', {
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      });
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
            quantity: -existingRun.billableLaptopCount,
            unitRatePaise: laptopRatePaise,
            amountPaise: -existingRun.laptopAmountPaise,
            occurredAt,
            createdBy: 'system:storage-accrual',
            referenceId: existingRun.id,
            referenceType: 'storage_accrual_reversal',
            notes: `Reversal of previous ${reversedMonthLabel} laptop storage charge (${existingRun.billableLaptopCount} billed device(s))`,
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
            quantity: -existingRun.billablePeripheralCount,
            unitRatePaise: peripheralRatePaise,
            amountPaise: -existingRun.peripheralAmountPaise,
            occurredAt,
            createdBy: 'system:storage-accrual',
            referenceId: existingRun.id,
            referenceType: 'storage_accrual_reversal',
            notes: `Reversal of previous ${reversedMonthLabel} peripheral storage charge (${existingRun.billablePeripheralCount} billed device(s))`,
          });
        }
      }
      if (existingRun.commitmentAmountPaise > 0n) {
        const representativeAsset = await findRepresentativeAsset();
        if (representativeAsset) {
          await this.ledger.create({
            eventType: 'STORAGE_COMMITMENT',
            asset: { connect: { id: representativeAsset.id } },
            client: { connect: { id: clientId } },
            quantity: -1,
            unitRatePaise: existingRun.commitmentAmountPaise,
            amountPaise: -existingRun.commitmentAmountPaise,
            occurredAt,
            createdBy: 'system:storage-accrual',
            referenceId: existingRun.id,
            referenceType: 'storage_accrual_reversal',
            notes: `Reversal of previous ${reversedMonthLabel} minimum commitment charge`,
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

    // Monthly minimum committed spend (SPEC.md "Commitment"): when configured
    // for this client, the flat amount is always billed, and only devices
    // beyond each threshold are billed per-device on top of it.
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: {
        commitmentAmountPaise: true,
        commitmentLaptopCount: true,
        commitmentPeripheralCount: true,
      },
    });
    const hasCommitment =
      client?.commitmentAmountPaise != null &&
      client.commitmentLaptopCount != null &&
      client.commitmentPeripheralCount != null;
    const commitmentAmountPaise = client?.commitmentAmountPaise ?? 0n;
    const commitmentLaptopCount = client?.commitmentLaptopCount ?? 0;
    const commitmentPeripheralCount = client?.commitmentPeripheralCount ?? 0;
    const billableLaptopCount = hasCommitment
      ? Math.max(0, laptopCount - commitmentLaptopCount)
      : laptopCount;
    const billablePeripheralCount = hasCommitment
      ? Math.max(0, peripheralCount - commitmentPeripheralCount)
      : peripheralCount;

    const laptopAmountPaise = BigInt(billableLaptopCount) * laptopRatePaise;
    const peripheralAmountPaise = BigInt(billablePeripheralCount) * peripheralRatePaise;
    const totalAmountPaise = commitmentAmountPaise + laptopAmountPaise + peripheralAmountPaise;
    const totalDeviceCount = laptopCount + peripheralCount;

    // A commitment is a minimum spend regardless of device count, so it still
    // bills even with zero devices in storage — only skip entirely when there's
    // truly nothing to bill (no commitment and no devices).
    if (totalDeviceCount === 0 && !hasCommitment) {
      // Still record the run even if no devices, but skip ledger events
      await this.prisma.storageAccrualRun.create({
        data: {
          client: { connect: { id: clientId } },
          periodStart,
          periodEnd,
          laptopCount: 0,
          peripheralCount: 0,
          billableLaptopCount: 0,
          billablePeripheralCount: 0,
          totalDeviceCount: 0,
          laptopAmountPaise: 0n,
          peripheralAmountPaise: 0n,
          commitmentAmountPaise: 0n,
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
        commitmentAmountPaise: 0n,
        totalAmountPaise: 0n,
        skipped: true,
        skipReason: 'No devices in storage',
      };
    }

    // Post STORAGE_COMMITMENT ledger event (flat minimum spend)
    if (commitmentAmountPaise > 0n) {
      const representativeAsset = await findRepresentativeAsset();
      if (representativeAsset) {
        await this.ledger.create({
          eventType: 'STORAGE_COMMITMENT',
          asset: { connect: { id: representativeAsset.id } },
          client: { connect: { id: clientId } },
          quantity: 1,
          unitRatePaise: commitmentAmountPaise,
          amountPaise: commitmentAmountPaise,
          occurredAt,
          createdBy: 'system:storage-accrual',
          referenceType: 'storage_accrual',
          notes: `Monthly minimum commitment (covers up to ${commitmentLaptopCount} laptops, ${commitmentPeripheralCount} peripherals)`,
        });
      } else {
        this.logger.warn(
          `Client ${clientId} has a storage commitment configured but no asset exists to attach the ledger charge to — skipped this month.`,
        );
      }
    }

    // Post STORAGE_LAPTOP ledger event for billable (over-commitment) laptops
    if (billableLaptopCount > 0) {
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
          quantity: billableLaptopCount,
          unitRatePaise: laptopRatePaise,
          amountPaise: laptopAmountPaise,
          occurredAt,
          createdBy: 'system:storage-accrual',
          referenceType: 'storage_accrual',
          notes: hasCommitment
            ? `Monthly storage accrual: ${billableLaptopCount} laptop/monitor device(s) over the ${commitmentLaptopCount}-device commitment @ ₹${Number(laptopRatePaise) / 100}/device`
            : `Monthly storage accrual: ${billableLaptopCount} laptop/monitor device(s) @ ₹${Number(laptopRatePaise) / 100}/device`,
        });
      }
    }

    // Post STORAGE_PERIPHERAL ledger event for billable (over-commitment) peripherals
    if (billablePeripheralCount > 0) {
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
          quantity: billablePeripheralCount,
          unitRatePaise: peripheralRatePaise,
          amountPaise: peripheralAmountPaise,
          occurredAt,
          createdBy: 'system:storage-accrual',
          referenceType: 'storage_accrual',
          notes: hasCommitment
            ? `Monthly storage accrual: ${billablePeripheralCount} peripheral device(s) over the ${commitmentPeripheralCount}-device commitment @ ₹${Number(peripheralRatePaise) / 100}/device`
            : `Monthly storage accrual: ${billablePeripheralCount} peripheral device(s) @ ₹${Number(peripheralRatePaise) / 100}/device`,
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
        billableLaptopCount,
        billablePeripheralCount,
        totalDeviceCount,
        laptopAmountPaise,
        peripheralAmountPaise,
        commitmentAmountPaise,
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
      commitmentAmountPaise,
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
    commitmentProjectedPaise: string;
    totalProjectedPaise: string;
    rates: { laptopPerDevicePaise: string; peripheralPerDevicePaise: string };
    commitment: {
      amountPaise: string;
      laptopCount: number;
      peripheralCount: number;
    } | null;
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
        select: {
          id: true,
          name: true,
          commitmentAmountPaise: true,
          commitmentLaptopCount: true,
          commitmentPeripheralCount: true,
        },
      }),
    ]);

    const [laptopRate, peripheralRate] = await Promise.all([
      this.rateCard.findEffectiveAt('STORAGE_LAPTOP', new Date()),
      this.rateCard.findEffectiveAt('STORAGE_PERIPHERAL', new Date()),
    ]);
    const laptopRatePaise = laptopRate ? laptopRate.unitRatePaise : BigInt(11400);
    const peripheralRatePaise = peripheralRate ? peripheralRate.unitRatePaise : BigInt(2800);

    const hasCommitment =
      client?.commitmentAmountPaise != null &&
      client.commitmentLaptopCount != null &&
      client.commitmentPeripheralCount != null;
    const commitmentAmountPaise = client?.commitmentAmountPaise ?? 0n;
    const commitmentLaptopCount = client?.commitmentLaptopCount ?? 0;
    const commitmentPeripheralCount = client?.commitmentPeripheralCount ?? 0;
    const billableLaptopCount = hasCommitment
      ? Math.max(0, laptopCount - commitmentLaptopCount)
      : laptopCount;
    const billablePeripheralCount = hasCommitment
      ? Math.max(0, peripheralCount - commitmentPeripheralCount)
      : peripheralCount;

    const laptopAmountPaise = BigInt(billableLaptopCount) * laptopRatePaise;
    const peripheralAmountPaise = BigInt(billablePeripheralCount) * peripheralRatePaise;
    const projectedTotalPaise = commitmentAmountPaise + laptopAmountPaise + peripheralAmountPaise;

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
      commitmentProjectedPaise: commitmentAmountPaise.toString(),
      totalProjectedPaise: projectedTotalPaise.toString(),
      rates: {
        laptopPerDevicePaise: laptopRatePaise.toString(),
        peripheralPerDevicePaise: peripheralRatePaise.toString(),
      },
      commitment: hasCommitment
        ? {
            amountPaise: commitmentAmountPaise.toString(),
            laptopCount: commitmentLaptopCount,
            peripheralCount: commitmentPeripheralCount,
          }
        : null,
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
