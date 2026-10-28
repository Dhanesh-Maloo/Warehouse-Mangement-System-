/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks intentionally use loose typing */
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ChargeBillingService } from './charge-billing.service';

describe('ChargeBillingService', () => {
  let mockPrisma: any;
  let mockAudit: { log: jest.Mock };
  let service: ChargeBillingService;

  const e1 = { id: 'e1', amountPaise: BigInt(12800), billedEvent: null };
  const e2 = { id: 'e2', amountPaise: BigInt(12800), billedEvent: null };

  beforeEach(() => {
    mockPrisma = {
      eventLedger: { findMany: jest.fn().mockResolvedValue([e1, e2]) },
      chargeBillingBatch: {
        create: jest
          .fn()
          .mockImplementation(({ data }) => Promise.resolve({ id: 'batch-1', ...data })),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
      },
      chargeBilledEvent: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((cb) => cb(mockPrisma)),
    };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new ChargeBillingService(mockPrisma, mockAudit as any);
  });

  describe('markBilled', () => {
    it('sums the amount from the ledger and records one batch for the client', async () => {
      const batch = await service.markBilled('client-1', 'Deployment', ['e1', 'e2'], 'user-1');

      expect(batch.totalAmountPaise).toBe(BigInt(25600));
      expect(mockPrisma.chargeBillingBatch.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          clientId: 'client-1',
          category: 'Deployment',
          eventCount: 2,
          billedBy: 'user-1',
          events: { create: [{ eventId: 'e1' }, { eventId: 'e2' }] },
        }),
      });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.markBilled', entityId: 'batch-1' }),
      );
    });

    it('only looks up charges that belong to the client', async () => {
      await service.markBilled('client-1', 'Deployment', ['e1', 'e2'], 'user-1');

      expect(mockPrisma.eventLedger.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['e1', 'e2'] }, clientId: 'client-1' } }),
      );
    });

    it('rejects when a charge is missing or belongs to another client', async () => {
      mockPrisma.eventLedger.findMany.mockResolvedValue([e1]);

      await expect(
        service.markBilled('client-1', 'Deployment', ['e1', 'e2'], 'user-1'),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrisma.chargeBillingBatch.create).not.toHaveBeenCalled();
    });

    it('rejects when a charge is already billed', async () => {
      mockPrisma.eventLedger.findMany.mockResolvedValue([
        e1,
        { ...e2, billedEvent: { eventId: 'e2' } },
      ]);

      await expect(
        service.markBilled('client-1', 'Deployment', ['e1', 'e2'], 'user-1'),
      ).rejects.toThrow(ConflictException);
      expect(mockPrisma.chargeBillingBatch.create).not.toHaveBeenCalled();
    });

    it('ignores duplicate ids in the request', async () => {
      mockPrisma.eventLedger.findMany.mockResolvedValue([e1]);

      const batch = await service.markBilled('client-1', 'Deployment', ['e1', 'e1'], 'user-1');

      expect(batch.eventCount).toBe(1);
    });
  });

  describe('undo', () => {
    it('deletes the batch and audits it', async () => {
      mockPrisma.chargeBillingBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        clientId: 'client-1',
        category: 'Deployment',
        eventCount: 2,
        totalAmountPaise: BigInt(25600),
      });

      await service.undo('batch-1', 'user-1');

      expect(mockPrisma.chargeBillingBatch.delete).toHaveBeenCalledWith({
        where: { id: 'batch-1' },
      });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'billing.undoBilled', entityId: 'batch-1' }),
      );
    });

    it("does not let a client admin undo another client's batch", async () => {
      mockPrisma.chargeBillingBatch.findUnique.mockResolvedValue({
        id: 'batch-1',
        clientId: 'client-2',
      });

      await expect(service.undo('batch-1', 'user-1', 'client-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrisma.chargeBillingBatch.delete).not.toHaveBeenCalled();
    });
  });

  describe('getState', () => {
    it('returns billed event ids and batches for the client', async () => {
      mockPrisma.chargeBilledEvent.findMany.mockResolvedValue([{ eventId: 'e1' }]);

      const state = await service.getState('client-1');

      expect(state.billedEventIds).toEqual(['e1']);
      expect(mockPrisma.chargeBilledEvent.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { batch: { clientId: 'client-1' } } }),
      );
    });
  });
});
