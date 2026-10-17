import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { InboundService } from './inbound.service';

describe('InboundService edits', () => {
  const oldDate = new Date('2026-10-18T05:30:00Z');

  let tx: {
    goodsReceivedNote: { update: jest.Mock };
    eventLedger: { findMany: jest.Mock; createMany: jest.Mock };
    eventSuppression: { findMany: jest.Mock };
    expectedDelivery: { update: jest.Mock };
    expectedDeliveryItem: { deleteMany: jest.Mock; update: jest.Mock; create: jest.Mock };
  };
  let prisma: {
    goodsReceivedNote: { findUnique: jest.Mock };
    expectedDelivery: { findUnique: jest.Mock };
    grnAsset: { findFirst: jest.Mock };
    asset: { findUnique: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };
  let rateCard: { findEffectiveAt: jest.Mock };
  let audit: { log: jest.Mock };
  let service: InboundService;

  beforeEach(() => {
    tx = {
      goodsReceivedNote: {
        update: jest.fn().mockResolvedValue({ id: 'grn-1', receivedAt: oldDate, assets: [] }),
      },
      eventLedger: { findMany: jest.fn(), createMany: jest.fn() },
      eventSuppression: { findMany: jest.fn().mockResolvedValue([]) },
      expectedDelivery: { update: jest.fn().mockResolvedValue({ items: [] }) },
      expectedDeliveryItem: { deleteMany: jest.fn(), update: jest.fn(), create: jest.fn() },
    };
    prisma = {
      goodsReceivedNote: { findUnique: jest.fn() },
      expectedDelivery: { findUnique: jest.fn() },
      grnAsset: { findFirst: jest.fn() },
      asset: { findUnique: jest.fn(), update: jest.fn() },
      $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    rateCard = {
      findEffectiveAt: jest.fn().mockResolvedValue({ unitRatePaise: BigInt(5000) }),
    };
    audit = { log: jest.fn() };
    service = new InboundService(
      prisma as never,
      rateCard as never,
      audit as never,
      { record: jest.fn() } as never,
    );
  });

  describe('updateGrn', () => {
    const grn = {
      id: 'grn-1',
      grnNumber: 'GRN-202610-0001',
      receivedAt: oldDate,
      courierRef: null,
      notes: null,
      assets: [{ assetId: 'a1', asset: { category: 'laptop' } }],
    };

    it('throws NotFound for an unknown GRN', async () => {
      prisma.goodsReceivedNote.findUnique.mockResolvedValue(null);
      await expect(service.updateGrn('x', {}, 'u1')).rejects.toThrow(NotFoundException);
    });

    it('rejects a future received date', async () => {
      prisma.goodsReceivedNote.findUnique.mockResolvedValue(grn);
      await expect(service.updateGrn('grn-1', { receivedAt: '2099-01-01' }, 'u1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('reverses live INGEST events at their original date and re-posts on the new date', async () => {
      prisma.goodsReceivedNote.findUnique.mockResolvedValue(grn);
      tx.eventLedger.findMany
        .mockResolvedValueOnce([
          {
            id: 'e1',
            eventType: 'INGEST',
            assetId: 'a1',
            clientId: 'c1',
            quantity: 1,
            unitRatePaise: BigInt(4800),
            amountPaise: BigInt(4800),
            occurredAt: oldDate,
          },
        ])
        .mockResolvedValueOnce([]);

      await service.updateGrn('grn-1', { receivedAt: '2026-10-16' }, 'u1');

      const [reversal, repost] = tx.eventLedger.createMany.mock.calls.map(
        (c: [{ data: Record<string, unknown>[] }]) => c[0].data[0],
      );
      expect(reversal).toMatchObject({
        eventType: 'CORRECTION_INGEST',
        quantity: -1,
        amountPaise: BigInt(-4800),
        occurredAt: oldDate,
        referenceType: 'correction',
        referenceId: 'e1',
      });
      expect(repost).toMatchObject({
        eventType: 'INGEST',
        unitRatePaise: BigInt(5000),
        referenceType: 'grn',
        referenceId: 'grn-1',
      });
      expect((repost.occurredAt as Date).toISOString().slice(0, 10)).toBe('2026-10-16');
    });

    it('skips events that were already reversed or are suppressed by a bundle', async () => {
      prisma.goodsReceivedNote.findUnique.mockResolvedValue(grn);
      const base = {
        eventType: 'INGEST',
        assetId: 'a1',
        clientId: 'c1',
        quantity: 1,
        unitRatePaise: BigInt(4800),
        amountPaise: BigInt(4800),
        occurredAt: oldDate,
      };
      tx.eventLedger.findMany
        .mockResolvedValueOnce([
          { ...base, id: 'reversed' },
          { ...base, id: 'suppressed' },
        ])
        .mockResolvedValueOnce([{ referenceId: 'reversed' }]);
      tx.eventSuppression.findMany.mockResolvedValue([{ suppressedEventId: 'suppressed' }]);

      await service.updateGrn('grn-1', { receivedAt: '2026-10-16' }, 'u1');

      for (const call of tx.eventLedger.createMany.mock.calls as [{ data: unknown[] }][]) {
        expect(call[0].data).toHaveLength(0);
      }
    });

    it('does not touch the ledger when only the courier ref changes', async () => {
      prisma.goodsReceivedNote.findUnique.mockResolvedValue(grn);
      await service.updateGrn('grn-1', { courierRef: 'AWB1' }, 'u1');
      expect(tx.eventLedger.createMany).not.toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'inbound.updateGrn' }),
      );
    });
  });

  describe('updateDelivery', () => {
    const delivery = {
      id: 'd1',
      status: 'partially_received',
      purchaseOrderRef: 'PO1',
      expectedArrivalDate: new Date(),
      notes: null,
      ivalueTicketNumber: null,
      clientTicketNumber: null,
      items: [
        {
          id: 'i1',
          category: 'laptop',
          model: 'M',
          manufacturer: 'X',
          quantity: 10,
          receivedQuantity: 0,
        },
      ],
      grns: [{ deviceCount: 6 }],
    };

    it('rejects a cancelled delivery', async () => {
      prisma.expectedDelivery.findUnique.mockResolvedValue({ ...delivery, status: 'cancelled' });
      await expect(service.updateDelivery('d1', {}, 'u1')).rejects.toThrow(BadRequestException);
    });

    it('rejects a total quantity below what is already received', async () => {
      prisma.expectedDelivery.findUnique.mockResolvedValue(delivery);
      await expect(
        service.updateDelivery(
          'd1',
          { items: [{ id: 'i1', category: 'laptop', model: 'M', manufacturer: 'X', quantity: 5 }] },
          'u1',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('marks the delivery completed when quantity is reduced to what was received', async () => {
      prisma.expectedDelivery.findUnique.mockResolvedValue(delivery);
      await service.updateDelivery(
        'd1',
        { items: [{ id: 'i1', category: 'laptop', model: 'M', manufacturer: 'X', quantity: 6 }] },
        'u1',
      );
      expect(tx.expectedDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }),
      );
    });

    it('clears an optional field when an empty string is sent', async () => {
      prisma.expectedDelivery.findUnique.mockResolvedValue(delivery);
      await service.updateDelivery('d1', { purchaseOrderRef: '  ' }, 'u1');
      expect(tx.expectedDelivery.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ purchaseOrderRef: null, status: undefined }),
        }),
      );
    });
  });

  describe('updateReceivedDevice', () => {
    const link = { asset: { id: 'a1', serialNumber: 'SN1', model: 'M', manufacturer: 'X' } };

    it('throws NotFound when the device is not on that GRN', async () => {
      prisma.grnAsset.findFirst.mockResolvedValue(null);
      await expect(service.updateReceivedDevice('g', 'a1', {}, 'u1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects a serial number that belongs to another asset', async () => {
      prisma.grnAsset.findFirst.mockResolvedValue(link);
      prisma.asset.findUnique.mockResolvedValue({ id: 'other' });
      await expect(
        service.updateReceivedDevice('g', 'a1', { serialNumber: 'SN2' }, 'u1'),
      ).rejects.toThrow(ConflictException);
    });

    it('rejects blanking a required field', async () => {
      prisma.grnAsset.findFirst.mockResolvedValue(link);
      await expect(service.updateReceivedDevice('g', 'a1', { model: ' ' }, 'u1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('updates the asset and writes an audit entry with old and new values', async () => {
      prisma.grnAsset.findFirst.mockResolvedValue(link);
      prisma.asset.findUnique.mockResolvedValue(null);
      prisma.asset.update.mockResolvedValue({ id: 'a1', serialNumber: 'SN2' });
      await service.updateReceivedDevice('g', 'a1', { serialNumber: 'SN2' }, 'u1');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'inbound.updateReceivedDevice',
          oldValue: expect.objectContaining({ serialNumber: 'SN1' }),
          newValue: expect.objectContaining({ serialNumber: 'SN2' }),
        }),
      );
    });
  });
});
