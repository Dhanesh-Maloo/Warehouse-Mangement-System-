import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ChargeBillingBatch } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface ChargeBillingState {
  /** Ledger event ids already invoiced for the client. */
  billedEventIds: string[];
  /** Most recent billing batches, newest first. */
  batches: ChargeBillingBatch[];
}

@Injectable()
export class ChargeBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Which charges are billed and the batch history, for one client. */
  async getState(clientId: string): Promise<ChargeBillingState> {
    const [batches, billed] = await Promise.all([
      this.prisma.chargeBillingBatch.findMany({
        where: { clientId },
        orderBy: { billedAt: 'desc' },
        take: 100,
      }),
      this.prisma.chargeBilledEvent.findMany({
        where: { batch: { clientId } },
        select: { eventId: true },
      }),
    ]);
    return { billedEventIds: billed.map((b) => b.eventId), batches };
  }

  /**
   * Mark a set of ledger charges as billed. Every id must belong to the client and be unbilled;
   * the amount is computed here from the ledger, never taken from the caller.
   */
  async markBilled(
    clientId: string,
    category: string,
    eventIds: string[],
    userId: string,
  ): Promise<ChargeBillingBatch> {
    const unique = [...new Set(eventIds)];

    try {
      return await this.prisma.$transaction(async (tx) => {
        const events = await tx.eventLedger.findMany({
          where: { id: { in: unique }, clientId },
          select: { id: true, amountPaise: true, billedEvent: { select: { eventId: true } } },
        });
        if (events.length !== unique.length) {
          throw new BadRequestException('Some of these charges were not found for this client');
        }
        if (events.some((e) => e.billedEvent)) {
          throw new ConflictException(
            'Some of these charges are already billed. Refresh the page and try again.',
          );
        }

        const total = events.reduce((sum, e) => sum + e.amountPaise, BigInt(0));
        const batch = await tx.chargeBillingBatch.create({
          data: {
            clientId,
            category,
            eventCount: events.length,
            totalAmountPaise: total,
            billedBy: userId,
            events: { create: events.map((e) => ({ eventId: e.id })) },
          },
        });

        await this.audit.log({
          userId,
          action: 'billing.markBilled',
          entity: 'ChargeBillingBatch',
          entityId: batch.id,
          newValue: {
            clientId,
            category,
            eventCount: events.length,
            totalAmountPaise: total.toString(),
          },
        });
        return batch;
      });
    } catch (err) {
      // The primary key on event_id stops a concurrent request billing the same charge twice.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException(
          'Some of these charges were just billed by someone else. Refresh the page.',
        );
      }
      throw err;
    }
  }

  /** Un-bill a batch so its charges show as pending again. scopeClientId limits client admins to their own client. */
  async undo(batchId: string, userId: string, scopeClientId?: string): Promise<void> {
    const batch = await this.prisma.chargeBillingBatch.findUnique({ where: { id: batchId } });
    if (!batch || (scopeClientId !== undefined && batch.clientId !== scopeClientId)) {
      throw new NotFoundException(`Billing batch ${batchId} not found`);
    }
    await this.prisma.chargeBillingBatch.delete({ where: { id: batchId } });
    await this.audit.log({
      userId,
      action: 'billing.undoBilled',
      entity: 'ChargeBillingBatch',
      entityId: batchId,
      oldValue: {
        clientId: batch.clientId,
        category: batch.category,
        eventCount: batch.eventCount,
        totalAmountPaise: batch.totalAmountPaise.toString(),
      },
    });
  }
}
