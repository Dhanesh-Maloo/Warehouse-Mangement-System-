/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks intentionally use loose
   typing rather than duplicating full Prisma/service signatures */
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InboundBillingService } from './inbound-billing.service';

describe('InboundBillingService', () => {
  let mockPrisma: any;
  let mockAudit: { log: jest.Mock };
  let service: InboundBillingService;

  const rates = (code: string): any[] =>
    code === 'INGEST_LAPTOP'
      ? [{ unitRatePaise: 4800n, effectiveFrom: new Date('2026-01-01'), effectiveTo: null }]
      : [{ unitRatePaise: 1400n, effectiveFrom: new Date('2026-01-01'), effectiveTo: null }];

  function setup(assets: { id: string; category: string }[]): void {
    mockPrisma = {
      asset: {
        findMany: jest
          .fn()
          .mockResolvedValue(assets.map((a) => ({ ...a, createdAt: new Date('2026-09-18') }))),
        updateMany: jest.fn().mockResolvedValue({ count: assets.length }),
      },
      rateCardItem: {
        findMany: jest
          .fn()
          .mockImplementation(({ where }: any) => Promise.resolve(rates(where.code))),
      },
      inboundBilling: {
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn(),
        create: jest
          .fn()
          .mockImplementation(({ data }: any) =>
            Promise.resolve({ id: 'ib-1', billedAt: new Date(), ...data }),
          ),
        delete: jest.fn().mockResolvedValue({}),
      },
      client: { findUnique: jest.fn().mockResolvedValue({ id: 'c1' }) },
      $transaction: jest
        .fn()
        .mockImplementation((arg: any) =>
          typeof arg === 'function' ? arg(mockPrisma) : Promise.all(arg),
        ),
    };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    service = new InboundBillingService(mockPrisma, mockAudit as any);
  }

  it('prices pending laptops at ₹48 and peripherals at ₹14', async () => {
    setup([
      { id: 'a1', category: 'laptop' },
      { id: 'a2', category: 'laptop' },
      { id: 'a3', category: 'monitor' },
      { id: 'a4', category: 'peripheral' },
    ]);
    const res = await service.getPending('c1');
    expect(res.laptopCount).toBe(3);
    expect(res.peripheralCount).toBe(1);
    expect(res.totalAmountPaise).toBe(String(3 * 4800 + 1400));
  });

  it('only considers assets with no INGEST event and not already billed', async () => {
    setup([]);
    await service.getPending('c1');
    expect(mockPrisma.asset.findMany.mock.calls[0][0].where).toEqual({
      clientId: 'c1',
      inboundBillingId: null,
      ledgerEntries: { none: { eventType: 'INGEST' } },
    });
  });

  it('marks pending assets as billed and records the batch', async () => {
    setup([
      { id: 'a1', category: 'laptop' },
      { id: 'a2', category: 'peripheral' },
    ]);
    const rec = await service.markBilled('c1', '2026-10', 'user-1');
    expect(rec.totalAmountPaise).toBe('6200');
    expect(mockPrisma.asset.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['a1', 'a2'] }, inboundBillingId: null },
      data: { inboundBillingId: 'ib-1' },
    });
    expect(mockAudit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'inbound_billing.mark_billed', userId: 'user-1' }),
    );
  });

  it('rejects when nothing is pending', async () => {
    setup([]);
    await expect(service.markBilled('c1', '2026-10', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(mockPrisma.inboundBilling.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown client', async () => {
    setup([{ id: 'a1', category: 'laptop' }]);
    mockPrisma.client.findUnique.mockResolvedValue(null);
    await expect(service.markBilled('nope', '2026-10', 'user-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('fails if another request claimed some assets first', async () => {
    setup([{ id: 'a1', category: 'laptop' }]);
    mockPrisma.asset.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.markBilled('c1', '2026-10', 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('undo releases the assets and deletes the record', async () => {
    setup([]);
    mockPrisma.inboundBilling.findUnique.mockResolvedValue({
      id: 'ib-1',
      clientId: 'c1',
      billingMonth: '2026-10',
      totalAmountPaise: 6200n,
    });
    await service.undo('ib-1', 'user-1');
    expect(mockPrisma.asset.updateMany).toHaveBeenCalledWith({
      where: { inboundBillingId: 'ib-1' },
      data: { inboundBillingId: null },
    });
    expect(mockPrisma.inboundBilling.delete).toHaveBeenCalledWith({ where: { id: 'ib-1' } });
  });

  it('undo 404s for an unknown record', async () => {
    setup([]);
    mockPrisma.inboundBilling.findUnique.mockResolvedValue(null);
    await expect(service.undo('x', 'user-1')).rejects.toBeInstanceOf(NotFoundException);
  });
});
