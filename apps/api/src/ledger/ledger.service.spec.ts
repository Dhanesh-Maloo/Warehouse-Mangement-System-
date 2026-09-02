/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks intentionally use loose
   typing rather than duplicating full Prisma/service signatures */
import { NotFoundException } from '@nestjs/common';
import { LedgerService } from './ledger.service';

describe('LedgerService', () => {
  let mockPrisma: any;
  let service: LedgerService;

  beforeEach(() => {
    mockPrisma = {
      eventLedger: {
        create: jest
          .fn()
          .mockImplementation((args) => Promise.resolve({ id: 'evt-new', ...args.data })),
        findMany: jest.fn(),
        findUnique: jest.fn(),
      },
      eventSuppression: {
        create: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    service = new LedgerService(mockPrisma);
  });

  describe('createCorrection', () => {
    const original = {
      id: 'evt-original',
      eventType: 'FULL_PREP',
      assetId: 'asset-1',
      clientId: 'client-1',
      quantity: 1,
      unitRatePaise: BigInt(50000),
      amountPaise: BigInt(50000),
    };

    it('throws NotFoundException if the original event does not exist', async () => {
      mockPrisma.eventLedger.findUnique.mockResolvedValue(null);
      await expect(service.createCorrection('missing-id', 'reason', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('creates a negative-quantity row referencing the original event, never mutating it', async () => {
      mockPrisma.eventLedger.findUnique.mockResolvedValue(original);
      await service.createCorrection('evt-original', 'wrong bundle', 'user-1');

      expect(mockPrisma.eventLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            quantity: -1,
            amountPaise: BigInt(-50000),
            referenceId: 'evt-original',
            referenceType: 'correction',
          }),
        }),
      );
      expect(mockPrisma.eventLedger.update).toBeUndefined();
      expect(mockPrisma.eventLedger.delete).toBeUndefined();
    });

    it('clears any suppressions the corrected event caused, so components become billable again', async () => {
      mockPrisma.eventLedger.findUnique.mockResolvedValue(original);
      await service.createCorrection('evt-original', 'wrong bundle', 'user-1');

      expect(mockPrisma.eventSuppression.deleteMany).toHaveBeenCalledWith({
        where: { suppressedByEventId: 'evt-original' },
      });
    });

    it('does not clear suppressions for an unrelated event when correcting a different one', async () => {
      mockPrisma.eventLedger.findUnique.mockResolvedValue(original);
      await service.createCorrection('evt-original', 'wrong bundle', 'user-1');

      const call = mockPrisma.eventSuppression.deleteMany.mock.calls[0][0];
      expect(call.where.suppressedByEventId).toBe('evt-original');
      expect(call.where.suppressedByEventId).not.toBe('some-other-event');
    });
  });

  describe('findSuppressedEventIds', () => {
    it('returns the set of suppressed event ids, scoped by asset when given', async () => {
      mockPrisma.eventSuppression.findMany.mockResolvedValue([
        { suppressedEventId: 'evt-a' },
        { suppressedEventId: 'evt-b' },
      ]);

      const result = await service.findSuppressedEventIds('asset-1');

      expect(mockPrisma.eventSuppression.findMany).toHaveBeenCalledWith({
        where: { assetId: 'asset-1' },
        select: { suppressedEventId: true },
      });
      expect(result).toEqual(new Set(['evt-a', 'evt-b']));
    });

    it('returns all suppressed event ids when no assetId is given', async () => {
      mockPrisma.eventSuppression.findMany.mockResolvedValue([{ suppressedEventId: 'evt-a' }]);

      await service.findSuppressedEventIds();

      expect(mockPrisma.eventSuppression.findMany).toHaveBeenCalledWith({
        where: undefined,
        select: { suppressedEventId: true },
      });
    });
  });
});
