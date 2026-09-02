import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Prisma, EventLedger } from '@prisma/client';

/**
 * The ledger is append-only. This service intentionally exposes ONLY create and findMany.
 * UPDATE and DELETE are also blocked at the database layer by a Postgres trigger
 * (installed by infra/prisma/seed.ts). Any other module that needs to write
 * ledger entries must inject this service — never access prisma.eventLedger directly.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.EventLedgerCreateInput): Promise<EventLedger> {
    return this.prisma.eventLedger.create({ data });
  }

  async findMany(args: Prisma.EventLedgerFindManyArgs): Promise<EventLedger[]> {
    return this.prisma.eventLedger.findMany(args);
  }

  async createSuppression(
    suppressedEventId: string,
    suppressedByEventId: string,
    assetId: string,
    clientId: string,
  ): Promise<void> {
    await this.prisma.eventSuppression.create({
      data: { suppressedEventId, suppressedByEventId, assetId, clientId },
    });
  }

  async findSuppressedEventIds(assetId?: string): Promise<Set<string>> {
    const suppressions = await this.prisma.eventSuppression.findMany({
      where: assetId ? { assetId } : undefined,
      select: { suppressedEventId: true },
    });
    return new Set(suppressions.map((s) => s.suppressedEventId));
  }

  // Corrections are new rows with negative quantity — the original row is never touched
  async createCorrection(
    originalEventId: string,
    reason: string,
    createdBy: string,
  ): Promise<EventLedger> {
    const original = await this.prisma.eventLedger.findUnique({
      where: { id: originalEventId },
    });
    if (!original) throw new NotFoundException(`Ledger event ${originalEventId} not found`);

    const correction = await this.create({
      eventType: `CORRECTION_${original.eventType}`,
      asset: { connect: { id: original.assetId } },
      client: { connect: { id: original.clientId } },
      quantity: -original.quantity,
      unitRatePaise: original.unitRatePaise,
      amountPaise: -original.amountPaise,
      occurredAt: new Date(),
      createdBy,
      referenceId: original.id,
      referenceType: 'correction',
      notes: reason,
    });

    // If the corrected event was a bundle charge that suppressed component
    // events (e.g. Full Prep suppressing INGEST/INSPECT), clear those
    // suppressions so the components are billable again (SPEC.md 6.2).
    await this.prisma.eventSuppression.deleteMany({
      where: { suppressedByEventId: originalEventId },
    });

    return correction;
  }
}
