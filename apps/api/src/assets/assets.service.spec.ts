import { BadRequestException } from '@nestjs/common';
import { AssetsService } from './assets.service';

describe('AssetsService', () => {
  let mockPrisma: {
    asset: { findMany: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  };
  let service: AssetsService;

  beforeEach(() => {
    mockPrisma = {
      asset: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
    };
    service = new AssetsService(mockPrisma as never, {} as never, {} as never);
  });

  describe('findAll', () => {
    it('filters by assetCondition when provided', async () => {
      await service.findAll({ assetCondition: 'new' });
      expect(mockPrisma.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ assetCondition: 'new' }) }),
      );
      expect(mockPrisma.asset.count).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ assetCondition: 'new' }) }),
      );
    });

    it('omits assetCondition from the filter when not provided', async () => {
      await service.findAll({});
      expect(mockPrisma.asset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.not.objectContaining({ assetCondition: expect.anything() }),
        }),
      );
    });
  });

  describe('updateStatus', () => {
    it('sets Date added from a date-only value, keeping the existing time of day in IST', async () => {
      const update = jest.fn().mockResolvedValue({});
      const prisma = {
        asset: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'a1',
            clientId: 'c1',
            currentStatus: 'in_storage',
            createdAt: new Date('2026-10-19T05:30:00Z'),
          }),
          update,
        },
        $transaction: jest.fn((fn: (t: unknown) => unknown) => fn({ asset: { update } })),
      };
      const svc = new AssetsService(prisma as never, {} as never, {} as never);
      await svc.updateStatus('a1', { createdAt: '2026-10-01' });
      expect(update).toHaveBeenCalledWith({
        where: { id: 'a1' },
        data: { createdAt: new Date('2026-10-01T11:00:00+05:30') },
      });
    });

    it('stores a trimmed description and clears it when sent empty', async () => {
      const update = jest.fn().mockResolvedValue({});
      const prisma = {
        asset: {
          findUnique: jest.fn().mockResolvedValue({ id: 'a1', currentStatus: 'in_storage' }),
          update,
        },
        $transaction: jest.fn((fn: (t: unknown) => unknown) => fn({ asset: { update } })),
      };
      const svc = new AssetsService(prisma as never, {} as never, {} as never);
      await svc.updateStatus('a1', { description: '  16GB / 512GB  ' });
      expect(update).toHaveBeenLastCalledWith({
        where: { id: 'a1' },
        data: { description: '16GB / 512GB' },
      });
      await svc.updateStatus('a1', { description: '' });
      expect(update).toHaveBeenLastCalledWith({
        where: { id: 'a1' },
        data: { description: null },
      });
    });

    it('rejects a Date added in the future', async () => {
      const prisma = {
        asset: {
          findUnique: jest
            .fn()
            .mockResolvedValue({ id: 'a1', createdAt: new Date('2026-10-19T05:30:00Z') }),
        },
      };
      const svc = new AssetsService(prisma as never, {} as never, {} as never);
      await expect(svc.updateStatus('a1', { createdAt: '2099-01-01' })).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('findAllForExport', () => {
    it('queries the full dataset without pagination, scoped by the given filters', async () => {
      await service.findAllForExport({ clientId: 'client-1', assetCondition: 'used' });
      expect(mockPrisma.asset.findMany).toHaveBeenCalledWith({
        where: { clientId: 'client-1', assetCondition: 'used' },
        include: { currentLocation: true },
        orderBy: { updatedAt: 'desc' },
      });
    });
  });
});
