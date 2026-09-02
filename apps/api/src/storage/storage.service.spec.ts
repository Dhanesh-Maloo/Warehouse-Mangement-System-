/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks intentionally use loose
   typing rather than duplicating full Prisma/service signatures */
import { StorageService } from './storage.service';

describe('StorageService — monthly minimum commitment', () => {
  let mockPrisma: any;
  let mockLedger: { create: jest.Mock };
  let mockRateCard: { findEffectiveAt: jest.Mock };
  let service: StorageService;

  const LAPTOP_RATE = BigInt(11400); // ₹114
  const PERIPHERAL_RATE = BigInt(2800); // ₹28
  const COMMITMENT_AMOUNT = BigInt(4275000); // ₹42,750

  function setup(opts: {
    laptopCount: number;
    peripheralCount: number;
    commitment?: { amountPaise: bigint; laptopCount: number; peripheralCount: number } | null;
    existingRun?: any;
    hasAnyAsset?: boolean;
  }): void {
    mockPrisma = {
      client: {
        findMany: jest.fn().mockResolvedValue([{ id: 'client-1', name: 'Test Client' }]),
        findUnique: jest.fn().mockResolvedValue(
          opts.commitment
            ? {
                commitmentAmountPaise: opts.commitment.amountPaise,
                commitmentLaptopCount: opts.commitment.laptopCount,
                commitmentPeripheralCount: opts.commitment.peripheralCount,
              }
            : {
                commitmentAmountPaise: null,
                commitmentLaptopCount: null,
                commitmentPeripheralCount: null,
              },
        ),
      },
      asset: {
        count: jest.fn().mockImplementation(({ where }: any) => {
          if (where.category === 'peripheral') return Promise.resolve(opts.peripheralCount);
          return Promise.resolve(opts.laptopCount);
        }),
        findFirst: jest.fn().mockImplementation(({ where }: any) => {
          if (where.category === 'peripheral') {
            return Promise.resolve(opts.peripheralCount > 0 ? { id: 'peripheral-asset-1' } : null);
          }
          if (where.category?.in) {
            return Promise.resolve(opts.laptopCount > 0 ? { id: 'laptop-asset-1' } : null);
          }
          // representative-asset lookup for the flat commitment charge (any status/category)
          return Promise.resolve(opts.hasAnyAsset === false ? null : { id: 'any-asset-1' });
        }),
      },
      storageAccrualRun: {
        findFirst: jest.fn().mockResolvedValue(opts.existingRun ?? null),
        create: jest.fn().mockResolvedValue({}),
      },
    };
    mockLedger = { create: jest.fn().mockResolvedValue({ id: 'ledger-1' }) };
    mockRateCard = {
      findEffectiveAt: jest.fn().mockImplementation((code: string) => {
        if (code === 'STORAGE_LAPTOP') return Promise.resolve({ unitRatePaise: LAPTOP_RATE });
        if (code === 'STORAGE_PERIPHERAL')
          return Promise.resolve({ unitRatePaise: PERIPHERAL_RATE });
        return Promise.resolve(null);
      }),
    };
    service = new StorageService(mockPrisma, mockLedger as any, mockRateCard as any);
  }

  it('bills purely per-device when the client has no commitment configured (unchanged behavior)', async () => {
    setup({ laptopCount: 5, peripheralCount: 10, commitment: null });

    const result = await service.runMonthlyAccrual();

    expect(result.clientResults[0].commitmentAmountPaise).toBe(0n);
    expect(result.clientResults[0].laptopAmountPaise).toBe(BigInt(5) * LAPTOP_RATE);
    expect(result.clientResults[0].peripheralAmountPaise).toBe(BigInt(10) * PERIPHERAL_RATE);
    expect(result.clientResults[0].totalAmountPaise).toBe(
      BigInt(5) * LAPTOP_RATE + BigInt(10) * PERIPHERAL_RATE,
    );
    expect(mockLedger.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'STORAGE_COMMITMENT' }),
    );
  });

  it('bills flat commitment only when device counts are under both thresholds', async () => {
    setup({
      laptopCount: 200,
      peripheralCount: 250,
      commitment: { amountPaise: COMMITMENT_AMOUNT, laptopCount: 300, peripheralCount: 300 },
    });

    const result = await service.runMonthlyAccrual();
    const r = result.clientResults[0];

    expect(r.commitmentAmountPaise).toBe(COMMITMENT_AMOUNT);
    expect(r.laptopAmountPaise).toBe(0n);
    expect(r.peripheralAmountPaise).toBe(0n);
    expect(r.totalAmountPaise).toBe(COMMITMENT_AMOUNT);
    expect(mockLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'STORAGE_COMMITMENT',
        quantity: 1,
        unitRatePaise: COMMITMENT_AMOUNT,
        amountPaise: COMMITMENT_AMOUNT,
      }),
    );
    // No per-device STORAGE_LAPTOP/STORAGE_PERIPHERAL charge when fully covered
    expect(mockLedger.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'STORAGE_LAPTOP' }),
    );
    expect(mockLedger.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'STORAGE_PERIPHERAL' }),
    );
  });

  it('exactly at both thresholds (300/300) still bills flat commitment only — the reported bug', async () => {
    setup({
      laptopCount: 300,
      peripheralCount: 300,
      commitment: { amountPaise: COMMITMENT_AMOUNT, laptopCount: 300, peripheralCount: 300 },
    });

    const result = await service.runMonthlyAccrual();
    const r = result.clientResults[0];

    expect(r.totalAmountPaise).toBe(COMMITMENT_AMOUNT);
    expect(r.laptopAmountPaise).toBe(0n);
    expect(r.peripheralAmountPaise).toBe(0n);
  });

  it('bills commitment plus per-device overage once a threshold is exceeded (301st laptop)', async () => {
    setup({
      laptopCount: 301,
      peripheralCount: 300,
      commitment: { amountPaise: COMMITMENT_AMOUNT, laptopCount: 300, peripheralCount: 300 },
    });

    const result = await service.runMonthlyAccrual();
    const r = result.clientResults[0];

    expect(r.laptopAmountPaise).toBe(BigInt(1) * LAPTOP_RATE);
    expect(r.peripheralAmountPaise).toBe(0n);
    expect(r.totalAmountPaise).toBe(COMMITMENT_AMOUNT + LAPTOP_RATE);
    expect(mockLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'STORAGE_LAPTOP',
        quantity: 1,
        amountPaise: LAPTOP_RATE,
      }),
    );
  });

  it('bills overage on both categories when both thresholds are exceeded', async () => {
    setup({
      laptopCount: 320,
      peripheralCount: 315,
      commitment: { amountPaise: COMMITMENT_AMOUNT, laptopCount: 300, peripheralCount: 300 },
    });

    const result = await service.runMonthlyAccrual();
    const r = result.clientResults[0];

    expect(r.laptopAmountPaise).toBe(BigInt(20) * LAPTOP_RATE);
    expect(r.peripheralAmountPaise).toBe(BigInt(15) * PERIPHERAL_RATE);
    expect(r.totalAmountPaise).toBe(
      COMMITMENT_AMOUNT + BigInt(20) * LAPTOP_RATE + BigInt(15) * PERIPHERAL_RATE,
    );
  });

  it('still bills the flat commitment even with zero devices in storage (minimum spend, not per-device)', async () => {
    setup({
      laptopCount: 0,
      peripheralCount: 0,
      commitment: { amountPaise: COMMITMENT_AMOUNT, laptopCount: 300, peripheralCount: 300 },
      hasAnyAsset: true,
    });

    const result = await service.runMonthlyAccrual();
    const r = result.clientResults[0];

    expect(r.skipped).toBe(false);
    expect(r.totalAmountPaise).toBe(COMMITMENT_AMOUNT);
  });

  it('skips billing entirely when there is no commitment and zero devices (unchanged behavior)', async () => {
    setup({ laptopCount: 0, peripheralCount: 0, commitment: null });

    const result = await service.runMonthlyAccrual();
    const r = result.clientResults[0];

    expect(r.skipped).toBe(true);
    expect(r.totalAmountPaise).toBe(0n);
    expect(mockLedger.create).not.toHaveBeenCalled();
  });

  it('reverses a prior run using the previously billed (overage) quantities, not raw device counts', async () => {
    setup({
      laptopCount: 305,
      peripheralCount: 300,
      commitment: { amountPaise: COMMITMENT_AMOUNT, laptopCount: 300, peripheralCount: 300 },
      existingRun: {
        id: 'run-1',
        periodStart: new Date('2026-08-01'),
        laptopCount: 302,
        peripheralCount: 300,
        billableLaptopCount: 2,
        billablePeripheralCount: 0,
        laptopAmountPaise: BigInt(2) * LAPTOP_RATE,
        peripheralAmountPaise: 0n,
        commitmentAmountPaise: COMMITMENT_AMOUNT,
      },
    });

    await service.runMonthlyAccrual();

    // Reversal quantity matches what was actually billed (2), not the raw stored count (302)
    expect(mockLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'STORAGE_LAPTOP',
        quantity: -2,
        amountPaise: -(BigInt(2) * LAPTOP_RATE),
        referenceType: 'storage_accrual_reversal',
      }),
    );
    expect(mockLedger.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'STORAGE_COMMITMENT',
        quantity: -1,
        amountPaise: -COMMITMENT_AMOUNT,
        referenceType: 'storage_accrual_reversal',
      }),
    );
  });
});
