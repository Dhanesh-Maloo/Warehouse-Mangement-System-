import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const LAPTOP_CODE = 'INGEST_LAPTOP';
const PERIPHERAL_CODE = 'INGEST_PERIPHERAL';
// Fallbacks mirror the seeded rate card (₹48 / ₹14) if no version covers a date.
const DEFAULT_LAPTOP_PAISE = 4800n;
const DEFAULT_PERIPHERAL_PAISE = 1400n;

interface RateVersion {
  unitRatePaise: bigint;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface InboundBillingRecord {
  id: string;
  billingMonth: string;
  laptopCount: number;
  peripheralCount: number;
  totalAmountPaise: string;
  billedBy: string;
  billedAt: Date;
}

export interface PendingInboundDevice {
  id: string;
  serialNumber: string;
  model: string;
  category: string;
  addedAt: Date;
  amountPaise: string;
}

export interface PendingInboundBilling {
  clientId: string;
  devices: PendingInboundDevice[];
  laptopCount: number;
  peripheralCount: number;
  laptopAmountPaise: string;
  peripheralAmountPaise: string;
  totalAmountPaise: string;
  rates: { laptopPaise: string; peripheralPaise: string };
  history: InboundBillingRecord[];
}

interface Totals {
  assetIds: string[];
  devices: PendingInboundDevice[];
  laptopCount: number;
  peripheralCount: number;
  laptopAmountPaise: bigint;
  peripheralAmountPaise: bigint;
}

type Db = Pick<PrismaService, 'asset' | 'rateCardItem'>;

/**
 * One-time inbound fee for devices that were added outside the inbound flow
 * (bulk imports, direct inserts) and therefore have no INGEST ledger event.
 * Billing is tracked on the asset, not in the ledger, so a device is invoiced once.
 */
@Injectable()
export class InboundBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getPending(clientId: string): Promise<PendingInboundBilling> {
    const [totals, history, laptopRates, peripheralRates] = await Promise.all([
      this.computePending(this.prisma, clientId),
      this.prisma.inboundBilling.findMany({
        where: { clientId },
        orderBy: { billedAt: 'desc' },
        take: 24,
      }),
      this.ratesFor(this.prisma, LAPTOP_CODE),
      this.ratesFor(this.prisma, PERIPHERAL_CODE),
    ]);
    const now = new Date();

    return {
      clientId,
      devices: totals.devices,
      laptopCount: totals.laptopCount,
      peripheralCount: totals.peripheralCount,
      laptopAmountPaise: totals.laptopAmountPaise.toString(),
      peripheralAmountPaise: totals.peripheralAmountPaise.toString(),
      totalAmountPaise: (totals.laptopAmountPaise + totals.peripheralAmountPaise).toString(),
      rates: {
        laptopPaise: this.pickRate(laptopRates, now, DEFAULT_LAPTOP_PAISE).toString(),
        peripheralPaise: this.pickRate(peripheralRates, now, DEFAULT_PERIPHERAL_PAISE).toString(),
      },
      history: history.map((h) => this.toRecord(h)),
    };
  }

  /** Marks every currently pending device as billed for the given month. */
  async markBilled(
    clientId: string,
    billingMonth: string,
    userId: string,
  ): Promise<InboundBillingRecord> {
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { id: true },
    });
    if (!client) throw new NotFoundException('Client not found');

    // Recomputed inside the transaction so what is stamped is exactly what is
    // charged, even if assets were added since the page loaded.
    const record = await this.prisma.$transaction(async (tx) => {
      const totals = await this.computePending(tx, clientId);
      if (totals.assetIds.length === 0) {
        throw new BadRequestException('Nothing pending to bill for this client');
      }

      const created = await tx.inboundBilling.create({
        data: {
          clientId,
          billingMonth,
          laptopCount: totals.laptopCount,
          peripheralCount: totals.peripheralCount,
          laptopAmountPaise: totals.laptopAmountPaise,
          peripheralAmountPaise: totals.peripheralAmountPaise,
          totalAmountPaise: totals.laptopAmountPaise + totals.peripheralAmountPaise,
          billedBy: userId,
        },
      });
      // inboundBillingId: null guards against a concurrent mark-billed claiming the same assets.
      const claimed = await tx.asset.updateMany({
        where: { id: { in: totals.assetIds }, inboundBillingId: null },
        data: { inboundBillingId: created.id },
      });
      if (claimed.count !== totals.assetIds.length) {
        throw new BadRequestException('Assets changed while billing; please retry');
      }
      return created;
    });

    await this.audit.log({
      userId,
      action: 'inbound_billing.mark_billed',
      entity: 'inbound_billing',
      entityId: record.id,
      newValue: {
        clientId,
        billingMonth,
        laptopCount: record.laptopCount,
        peripheralCount: record.peripheralCount,
        totalAmountPaise: record.totalAmountPaise.toString(),
      },
    });

    return this.toRecord(record);
  }

  /** Reverts a mark-billed so its devices show as pending again (mis-click recovery). */
  async undo(id: string, userId: string): Promise<void> {
    const record = await this.prisma.inboundBilling.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('Billing record not found');

    await this.prisma.$transaction([
      this.prisma.asset.updateMany({
        where: { inboundBillingId: id },
        data: { inboundBillingId: null },
      }),
      this.prisma.inboundBilling.delete({ where: { id } }),
    ]);

    await this.audit.log({
      userId,
      action: 'inbound_billing.undo',
      entity: 'inbound_billing',
      entityId: id,
      oldValue: {
        clientId: record.clientId,
        billingMonth: record.billingMonth,
        totalAmountPaise: record.totalAmountPaise.toString(),
      },
    });
  }

  private toRecord(r: {
    id: string;
    billingMonth: string;
    laptopCount: number;
    peripheralCount: number;
    totalAmountPaise: bigint;
    billedBy: string;
    billedAt: Date;
  }): InboundBillingRecord {
    return {
      id: r.id,
      billingMonth: r.billingMonth,
      laptopCount: r.laptopCount,
      peripheralCount: r.peripheralCount,
      totalAmountPaise: r.totalAmountPaise.toString(),
      billedBy: r.billedBy,
      billedAt: r.billedAt,
    };
  }

  private async computePending(db: Db, clientId: string): Promise<Totals> {
    const [assets, laptopRates, peripheralRates] = await Promise.all([
      db.asset.findMany({
        where: {
          clientId,
          inboundBillingId: null,
          ledgerEntries: { none: { eventType: 'INGEST' } },
        },
        select: { id: true, serialNumber: true, model: true, category: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.ratesFor(db, LAPTOP_CODE),
      this.ratesFor(db, PERIPHERAL_CODE),
    ]);

    const totals: Totals = {
      assetIds: [],
      devices: [],
      laptopCount: 0,
      peripheralCount: 0,
      laptopAmountPaise: 0n,
      peripheralAmountPaise: 0n,
    };
    for (const a of assets) {
      totals.assetIds.push(a.id);
      let amount: bigint;
      if (a.category === 'peripheral') {
        amount = this.pickRate(peripheralRates, a.createdAt, DEFAULT_PERIPHERAL_PAISE);
        totals.peripheralCount += 1;
        totals.peripheralAmountPaise += amount;
      } else {
        // Laptops and monitors share the laptop inbound rate, as in the inbound flow.
        amount = this.pickRate(laptopRates, a.createdAt, DEFAULT_LAPTOP_PAISE);
        totals.laptopCount += 1;
        totals.laptopAmountPaise += amount;
      }
      totals.devices.push({
        id: a.id,
        serialNumber: a.serialNumber,
        model: a.model,
        category: a.category,
        addedAt: a.createdAt,
        amountPaise: amount.toString(),
      });
    }
    return totals;
  }

  private ratesFor(db: Pick<PrismaService, 'rateCardItem'>, code: string): Promise<RateVersion[]> {
    return db.rateCardItem.findMany({
      where: { code },
      select: { unitRatePaise: true, effectiveFrom: true, effectiveTo: true },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  // Rate in force when the device was received (rate-card versioning rule), not today's.
  private pickRate(versions: RateVersion[], at: Date, fallback: bigint): bigint {
    const hit = versions.find(
      (v) => v.effectiveFrom <= at && (v.effectiveTo === null || v.effectiveTo > at),
    );
    return hit ? hit.unitRatePaise : fallback;
  }
}
