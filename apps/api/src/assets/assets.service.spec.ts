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
