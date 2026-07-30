/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks intentionally use loose
   typing rather than duplicating full Prisma/service signatures */
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { RepairService } from './repair.service';

describe('RepairService', () => {
  let mockPrisma: any;
  let mockLedger: { create: jest.Mock };
  let mockRateCard: { findEffectiveAt: jest.Mock };
  let mockAudit: { log: jest.Mock };
  let service: RepairService;

  const baseAsset = {
    id: 'asset-1',
    clientId: 'client-1',
    currentStatus: 'in_storage',
    serialNumber: 'SN-1',
    model: 'ModelX',
    manufacturer: 'Acme',
  };

  beforeEach(() => {
    mockPrisma = {
      asset: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      repairRequest: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((cb) => cb(mockPrisma)),
    };
    mockLedger = { create: jest.fn().mockResolvedValue({ id: 'ledger-1' }) };
    mockRateCard = { findEffectiveAt: jest.fn() };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

    service = new RepairService(
      mockPrisma,
      mockLedger as any,
      mockRateCard as any,
      mockAudit as any,
    );
  });

  describe('create', () => {
    const dto = {
      clientId: 'client-1',
      assetId: 'asset-1',
      serviceCenterName: 'FixIt Co',
    };

    it('throws NotFoundException if the asset does not exist', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue(null);

      await expect(service.create(dto as any, 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if the asset belongs to a different client', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue({ ...baseAsset, clientId: 'other-client' });

      await expect(service.create(dto as any, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if the asset is not in_storage', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue({ ...baseAsset, currentStatus: 'deployed' });

      await expect(service.create(dto as any, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('creates the repair request, updates the asset, and posts a ledger event with the resolved rate', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue(baseAsset);
      mockPrisma.repairRequest.create.mockResolvedValue({
        id: 'repair-1',
        assetId: 'asset-1',
        status: 'pending',
      });
      mockPrisma.asset.update.mockResolvedValue({ ...baseAsset, currentStatus: 'in_repair' });
      mockPrisma.asset.findMany.mockResolvedValue([baseAsset]);
      mockRateCard.findEffectiveAt.mockResolvedValue({ unitRatePaise: BigInt(500) });

      const result = await service.create(dto as any, 'user-1');

      expect(mockPrisma.repairRequest.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          clientId: 'client-1',
          assetId: 'asset-1',
          serviceCenterName: 'FixIt Co',
          status: 'pending',
          createdByUserId: 'user-1',
        }),
      });
      expect(mockPrisma.asset.update).toHaveBeenCalledWith({
        where: { id: 'asset-1' },
        data: { currentStatus: 'in_repair' },
      });
      expect(mockLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'REPAIR',
          unitRatePaise: BigInt(500),
          amountPaise: BigInt(500),
          referenceId: 'repair-1',
          referenceType: 'repair',
        }),
      );
      expect(result.id).toBe('repair-1');
    });

    it('posts a ledger event with unitRatePaise 0 when no rate is configured', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue(baseAsset);
      mockPrisma.repairRequest.create.mockResolvedValue({
        id: 'repair-2',
        assetId: 'asset-1',
        status: 'pending',
      });
      mockPrisma.asset.update.mockResolvedValue({ ...baseAsset, currentStatus: 'in_repair' });
      mockPrisma.asset.findMany.mockResolvedValue([baseAsset]);
      mockRateCard.findEffectiveAt.mockResolvedValue(null);

      await service.create(dto as any, 'user-1');

      expect(mockLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          unitRatePaise: BigInt(0),
          amountPaise: BigInt(0),
        }),
      );
    });

    it('defaults slaTargetAt to 5 business days ahead when not provided', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue(baseAsset);
      mockPrisma.repairRequest.create.mockResolvedValue({
        id: 'repair-3',
        assetId: 'asset-1',
        status: 'pending',
      });
      mockPrisma.asset.update.mockResolvedValue({ ...baseAsset, currentStatus: 'in_repair' });
      mockPrisma.asset.findMany.mockResolvedValue([baseAsset]);
      mockRateCard.findEffectiveAt.mockResolvedValue(null);

      const before = Date.now();
      await service.create(dto as any, 'user-1');

      const createCall = mockPrisma.repairRequest.create.mock.calls[0][0];
      const slaTargetAt: Date = createCall.data.slaTargetAt;
      expect(slaTargetAt).toBeInstanceOf(Date);
      // 5 business days of 9-hour days is at least 5 calendar days out, and
      // can never land before the request was created.
      expect(slaTargetAt.getTime()).toBeGreaterThan(before);
      expect(slaTargetAt.getTime() - before).toBeGreaterThanOrEqual(5 * 24 * 60 * 60 * 1000);
    });

    it('uses the provided slaTargetAt override instead of the default', async () => {
      const override = '2026-08-15T10:00:00.000Z';
      mockPrisma.asset.findUnique.mockResolvedValue(baseAsset);
      mockPrisma.repairRequest.create.mockResolvedValue({
        id: 'repair-4',
        assetId: 'asset-1',
        status: 'pending',
      });
      mockPrisma.asset.update.mockResolvedValue({ ...baseAsset, currentStatus: 'in_repair' });
      mockPrisma.asset.findMany.mockResolvedValue([baseAsset]);
      mockRateCard.findEffectiveAt.mockResolvedValue(null);

      await service.create({ ...dto, slaTargetAt: override } as any, 'user-1');

      const createCall = mockPrisma.repairRequest.create.mock.calls[0][0];
      expect(createCall.data.slaTargetAt).toEqual(new Date(override));
    });
  });

  describe('isOverdue', () => {
    it('flags a non-terminal repair past its slaTargetAt as overdue', async () => {
      mockPrisma.repairRequest.findMany.mockResolvedValue([
        {
          id: 'repair-1',
          assetId: 'asset-1',
          status: 'in_repair',
          slaTargetAt: new Date(Date.now() - 60_000),
        },
      ]);
      mockPrisma.asset.findMany.mockResolvedValue([baseAsset]);

      const [result] = await service.findAll('client-1');

      expect(result.isOverdue).toBe(true);
    });

    it('does not flag a repair whose slaTargetAt is still in the future', async () => {
      mockPrisma.repairRequest.findMany.mockResolvedValue([
        {
          id: 'repair-1',
          assetId: 'asset-1',
          status: 'in_repair',
          slaTargetAt: new Date(Date.now() + 60_000),
        },
      ]);
      mockPrisma.asset.findMany.mockResolvedValue([baseAsset]);

      const [result] = await service.findAll('client-1');

      expect(result.isOverdue).toBe(false);
    });

    it('does not flag a completed repair even if past its slaTargetAt', async () => {
      mockPrisma.repairRequest.findMany.mockResolvedValue([
        {
          id: 'repair-1',
          assetId: 'asset-1',
          status: 'completed',
          slaTargetAt: new Date(Date.now() - 60_000),
        },
      ]);
      mockPrisma.asset.findMany.mockResolvedValue([baseAsset]);

      const [result] = await service.findAll('client-1');

      expect(result.isOverdue).toBe(false);
    });
  });

  describe('updateStatus', () => {
    function setupRepair(status: string): void {
      mockPrisma.repairRequest.findUnique.mockResolvedValue({
        id: 'repair-1',
        assetId: 'asset-1',
        status,
      });
      mockPrisma.repairRequest.update.mockImplementation(({ data }: any) => ({
        id: 'repair-1',
        assetId: 'asset-1',
        ...data,
      }));
      mockPrisma.asset.update.mockResolvedValue({ ...baseAsset, currentStatus: 'in_storage' });
      mockPrisma.asset.findMany.mockResolvedValue([baseAsset]);
    }

    it('throws NotFoundException if the repair request does not exist', async () => {
      mockPrisma.repairRequest.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus('missing', { status: 'sent' } as any, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it.each([
      ['pending', 'sent'],
      ['sent', 'in_repair'],
      ['in_repair', 'returned'],
      ['returned', 'completed'],
    ])('allows the transition %s -> %s', async (from, to) => {
      setupRepair(from);

      const result = await service.updateStatus('repair-1', { status: to } as any, 'user-1');

      expect(result.status).toBe(to);
    });

    it('rejects an invalid transition (pending -> completed)', async () => {
      setupRepair('pending');

      await expect(
        service.updateStatus('repair-1', { status: 'completed' } as any, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects transitions from a terminal status', async () => {
      setupRepair('completed');

      await expect(
        service.updateStatus('repair-1', { status: 'sent' } as any, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('reverts the asset to in_storage on returned', async () => {
      setupRepair('in_repair');

      await service.updateStatus('repair-1', { status: 'returned' } as any, 'user-1');

      expect(mockPrisma.asset.update).toHaveBeenCalledWith({
        where: { id: 'asset-1' },
        data: { currentStatus: 'in_storage' },
      });
    });

    it('reverts the asset to in_storage on cancelled', async () => {
      setupRepair('pending');

      await service.updateStatus('repair-1', { status: 'cancelled' } as any, 'user-1');

      expect(mockPrisma.asset.update).toHaveBeenCalledWith({
        where: { id: 'asset-1' },
        data: { currentStatus: 'in_storage' },
      });
    });

    it.each(['sent', 'in_repair', 'completed'])(
      'does not touch the asset status on transition to %s',
      async (to) => {
        const from = to === 'sent' ? 'pending' : to === 'in_repair' ? 'sent' : 'returned';
        setupRepair(from);

        await service.updateStatus('repair-1', { status: to } as any, 'user-1');

        expect(mockPrisma.asset.update).not.toHaveBeenCalled();
      },
    );
  });
});
