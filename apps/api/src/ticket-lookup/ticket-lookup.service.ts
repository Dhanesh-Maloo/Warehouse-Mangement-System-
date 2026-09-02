import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';

export interface TicketLookupLedgerEvent {
  eventType: string;
  amountPaise: bigint;
  occurredAt: Date;
}

export interface TicketLookupItem {
  module: 'inbound' | 'retrieval' | 'inspection' | 'deployment' | 'disposal' | 'repair';
  id: string;
  ivalueTicketNumber: string | null;
  clientTicketNumber: string | null;
  workDescription: string;
  status: string;
  date: Date;
  asset: { serialNumber: string; model: string; manufacturer: string } | null;
  ledgerEvents: TicketLookupLedgerEvent[];
  amountPaise: bigint;
}

export interface TicketLookupResult {
  query: string;
  items: TicketLookupItem[];
  totalAmountPaise: bigint;
}

const ASSET_SELECT = { serialNumber: true, model: true, manufacturer: true } as const;

@Injectable()
export class TicketLookupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Sums ledger amounts posted against a batch of module-record ids, including
   * any corrections (append-only ledger — corrections are separate rows that
   * reference the original event, never an edit of it). Returns a map keyed
   * by the original referenceId (the module record's id, or — for inbound —
   * the GRN id, since that's what INGEST events reference).
   */
  private async sumAmountsByReference(
    referenceType: string,
    referenceIds: string[],
  ): Promise<Map<string, bigint>> {
    const totals = new Map<string, bigint>();
    if (referenceIds.length === 0) return totals;

    // A suppressed event was replaced by a bundle charge (e.g. Full Prep
    // suppressing its component INGEST/INSPECT events) — exclude it so the
    // total doesn't double-count it alongside the bundle charge.
    const suppressedIds = await this.ledger.findSuppressedEventIds();

    const primary = await this.prisma.eventLedger.findMany({
      where: { referenceType, referenceId: { in: referenceIds } },
      select: { id: true, referenceId: true, amountPaise: true, eventType: true, occurredAt: true },
    });
    for (const p of primary) {
      if (!p.referenceId || suppressedIds.has(p.id)) continue;
      totals.set(p.referenceId, (totals.get(p.referenceId) ?? BigInt(0)) + p.amountPaise);
    }

    const primaryIds = primary.map((p) => p.id);
    if (primaryIds.length > 0) {
      const corrections = await this.prisma.eventLedger.findMany({
        where: { referenceType: 'correction', referenceId: { in: primaryIds } },
        select: { referenceId: true, amountPaise: true },
      });
      const primaryIdToRecordId = new Map(primary.map((p) => [p.id, p.referenceId]));
      for (const c of corrections) {
        if (!c.referenceId) continue;
        const recordId = primaryIdToRecordId.get(c.referenceId);
        if (!recordId) continue;
        totals.set(recordId, (totals.get(recordId) ?? BigInt(0)) + c.amountPaise);
      }
    }

    return totals;
  }

  private async ledgerEventsFor(
    referenceType: string,
    referenceIds: string[],
  ): Promise<Map<string, TicketLookupLedgerEvent[]>> {
    const byRecord = new Map<string, TicketLookupLedgerEvent[]>();
    if (referenceIds.length === 0) return byRecord;

    const suppressedIds = await this.ledger.findSuppressedEventIds();

    const primary = await this.prisma.eventLedger.findMany({
      where: { referenceType, referenceId: { in: referenceIds } },
      select: { id: true, referenceId: true, amountPaise: true, eventType: true, occurredAt: true },
      orderBy: { occurredAt: 'asc' },
    });
    for (const p of primary) {
      if (!p.referenceId || suppressedIds.has(p.id)) continue;
      const list = byRecord.get(p.referenceId) ?? [];
      list.push({ eventType: p.eventType, amountPaise: p.amountPaise, occurredAt: p.occurredAt });
      byRecord.set(p.referenceId, list);
    }

    const primaryIds = primary.map((p) => p.id);
    if (primaryIds.length > 0) {
      const corrections = await this.prisma.eventLedger.findMany({
        where: { referenceType: 'correction', referenceId: { in: primaryIds } },
        select: { referenceId: true, amountPaise: true, eventType: true, occurredAt: true },
        orderBy: { occurredAt: 'asc' },
      });
      const primaryIdToRecordId = new Map(primary.map((p) => [p.id, p.referenceId]));
      for (const c of corrections) {
        if (!c.referenceId) continue;
        const recordId = primaryIdToRecordId.get(c.referenceId);
        if (!recordId) continue;
        const list = byRecord.get(recordId) ?? [];
        list.push({ eventType: c.eventType, amountPaise: c.amountPaise, occurredAt: c.occurredAt });
        byRecord.set(recordId, list);
      }
    }

    return byRecord;
  }

  async lookup(query: string, clientId?: string): Promise<TicketLookupResult> {
    const q = query.trim();
    if (!q) return { query: q, items: [], totalAmountPaise: BigInt(0) };

    const ticketMatch = {
      OR: [
        { ivalueTicketNumber: { contains: q, mode: 'insensitive' as const } },
        { clientTicketNumber: { contains: q, mode: 'insensitive' as const } },
      ],
    };

    const [deliveries, retrievals, inspections, deployments, disposals, repairs] =
      await Promise.all([
        this.prisma.expectedDelivery.findMany({
          where: { ...ticketMatch, ...(clientId ? { clientId } : {}) },
          include: { grns: { select: { id: true } } },
        }),
        this.prisma.retrievalRequest.findMany({
          where: { ...ticketMatch, ...(clientId ? { clientId } : {}) },
          include: { asset: { select: ASSET_SELECT } },
        }),
        this.prisma.inspection.findMany({
          where: { ...ticketMatch, ...(clientId ? { asset: { clientId } } : {}) },
          include: { asset: { select: ASSET_SELECT } },
        }),
        this.prisma.deploymentOrder.findMany({
          where: { ...ticketMatch, ...(clientId ? { clientId } : {}) },
          include: { asset: { select: ASSET_SELECT } },
        }),
        this.prisma.disposalRequest.findMany({
          where: { ...ticketMatch, ...(clientId ? { clientId } : {}) },
          include: { asset: { select: ASSET_SELECT } },
        }),
        this.prisma.repairRequest.findMany({
          where: { ...ticketMatch, ...(clientId ? { clientId } : {}) },
        }),
      ]);

    // Inbound is special-cased: ticket numbers live on ExpectedDelivery, but
    // INGEST ledger events reference the GRN id, not the delivery id.
    const grnIds = deliveries.flatMap((d) => d.grns.map((g) => g.id));
    const [grnTotals, grnEvents] = await Promise.all([
      this.sumAmountsByReference('grn', grnIds),
      this.ledgerEventsFor('grn', grnIds),
    ]);

    const [
      retrievalTotals,
      inspectionTotals,
      deploymentTotals,
      disposalTotals,
      repairTotals,
      retrievalEvents,
      inspectionEvents,
      deploymentEvents,
      disposalEvents,
      repairEvents,
    ] = await Promise.all([
      this.sumAmountsByReference(
        'retrieval',
        retrievals.map((r) => r.id),
      ),
      this.sumAmountsByReference(
        'inspection',
        inspections.map((i) => i.id),
      ),
      this.sumAmountsByReference(
        'deployment_order',
        deployments.map((d) => d.id),
      ),
      this.sumAmountsByReference(
        'disposal',
        disposals.map((d) => d.id),
      ),
      this.sumAmountsByReference(
        'repair',
        repairs.map((r) => r.id),
      ),
      this.ledgerEventsFor(
        'retrieval',
        retrievals.map((r) => r.id),
      ),
      this.ledgerEventsFor(
        'inspection',
        inspections.map((i) => i.id),
      ),
      this.ledgerEventsFor(
        'deployment_order',
        deployments.map((d) => d.id),
      ),
      this.ledgerEventsFor(
        'disposal',
        disposals.map((d) => d.id),
      ),
      this.ledgerEventsFor(
        'repair',
        repairs.map((r) => r.id),
      ),
    ]);

    const items: TicketLookupItem[] = [];

    for (const d of deliveries) {
      const amount = d.grns.reduce((sum, g) => sum + (grnTotals.get(g.id) ?? BigInt(0)), BigInt(0));
      const events = d.grns.flatMap((g) => grnEvents.get(g.id) ?? []);
      items.push({
        module: 'inbound',
        id: d.id,
        ivalueTicketNumber: d.ivalueTicketNumber,
        clientTicketNumber: d.clientTicketNumber,
        workDescription: d.purchaseOrderRef
          ? `Inbound delivery — PO ${d.purchaseOrderRef}`
          : 'Inbound delivery — no PO reference',
        status: d.status,
        date: d.createdAt,
        asset: null,
        ledgerEvents: events,
        amountPaise: amount,
      });
    }

    for (const r of retrievals) {
      items.push({
        module: 'retrieval',
        id: r.id,
        ivalueTicketNumber: r.ivalueTicketNumber,
        clientTicketNumber: r.clientTicketNumber,
        workDescription: `Retrieval — ${r.bundleType} bundle`,
        status: r.status,
        date: r.requestedAt,
        asset: r.asset,
        ledgerEvents: retrievalEvents.get(r.id) ?? [],
        amountPaise: retrievalTotals.get(r.id) ?? BigInt(0),
      });
    }

    for (const i of inspections) {
      items.push({
        module: 'inspection',
        id: i.id,
        ivalueTicketNumber: i.ivalueTicketNumber,
        clientTicketNumber: i.clientTicketNumber,
        workDescription: `Inspection — ${i.type} (${i.status})`,
        status: i.status,
        date: i.startedAt,
        asset: i.asset,
        ledgerEvents: inspectionEvents.get(i.id) ?? [],
        amountPaise: inspectionTotals.get(i.id) ?? BigInt(0),
      });
    }

    for (const o of deployments) {
      items.push({
        module: 'deployment',
        id: o.id,
        ivalueTicketNumber: o.ivalueTicketNumber,
        clientTicketNumber: o.clientTicketNumber,
        workDescription: `Deployment — ${o.bundleType} bundle`,
        status: o.status,
        date: o.requestedAt,
        asset: o.asset,
        ledgerEvents: deploymentEvents.get(o.id) ?? [],
        amountPaise: deploymentTotals.get(o.id) ?? BigInt(0),
      });
    }

    for (const dp of disposals) {
      items.push({
        module: 'disposal',
        id: dp.id,
        ivalueTicketNumber: dp.ivalueTicketNumber,
        clientTicketNumber: dp.clientTicketNumber,
        workDescription: `Disposal — ${dp.disposalType}`,
        status: dp.status,
        date: dp.createdAt,
        asset: dp.asset,
        ledgerEvents: disposalEvents.get(dp.id) ?? [],
        amountPaise: disposalTotals.get(dp.id) ?? BigInt(0),
      });
    }

    const repairAssets = repairs.length
      ? await this.prisma.asset.findMany({
          where: { id: { in: repairs.map((r) => r.assetId) } },
          select: { id: true, ...ASSET_SELECT },
        })
      : [];
    const repairAssetById = new Map(repairAssets.map((a) => [a.id, a]));

    for (const rp of repairs) {
      const assetRow = repairAssetById.get(rp.assetId) ?? null;
      items.push({
        module: 'repair',
        id: rp.id,
        ivalueTicketNumber: rp.ivalueTicketNumber,
        clientTicketNumber: rp.clientTicketNumber,
        workDescription: `Repair — ${rp.repairType}${rp.repairCategory ? ` / ${rp.repairCategory}` : ''} at ${rp.serviceCenterName}`,
        status: rp.status,
        date: rp.requestedAt,
        asset: assetRow,
        ledgerEvents: repairEvents.get(rp.id) ?? [],
        amountPaise: repairTotals.get(rp.id) ?? BigInt(0),
      });
    }

    items.sort((a, b) => b.date.getTime() - a.date.getTime());
    const totalAmountPaise = items.reduce((sum, it) => sum + it.amountPaise, BigInt(0));

    return { query: q, items, totalAmountPaise };
  }
}
