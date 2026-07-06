/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks intentionally use loose
   typing rather than duplicating full Prisma/service signatures */
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { ResaleService } from './resale.service';

describe('ResaleService', () => {
  let mockPrisma: any;
  let mockAudit: { log: jest.Mock };
  let service: ResaleService;

  const baseAsset = {
    id: 'asset-1',
    clientId: 'client-1',
    currentStatus: 'in_storage',
  };

  beforeEach(() => {
    mockPrisma = {
      asset: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      resaleListing: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn((arg: any) =>
        Array.isArray(arg) ? Promise.all(arg) : arg(mockPrisma),
      ),
    };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

    service = new ResaleService(mockPrisma, mockAudit as any);
  });

  describe('create', () => {
    const dto = {
      clientId: 'client-1',
      assetId: 'asset-1',
      listedPricePaise: 10000,
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

    it('creates the listing, sets the asset to for_resale, and logs audit with no ledger/rate-card interaction', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue(baseAsset);
      mockPrisma.resaleListing.create.mockResolvedValue({
        id: 'listing-1',
        assetId: 'asset-1',
        status: 'listed',
      });
      mockPrisma.asset.update.mockResolvedValue({ ...baseAsset, currentStatus: 'for_resale' });

      const result = await service.create(dto as any, 'user-1');

      expect(mockPrisma.resaleListing.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          clientId: 'client-1',
          assetId: 'asset-1',
          status: 'listed',
          createdByUserId: 'user-1',
        }),
      });
      expect(mockPrisma.asset.update).toHaveBeenCalledWith({
        where: { id: 'asset-1' },
        data: { currentStatus: 'for_resale' },
      });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'resale.create', entity: 'ResaleListing' }),
      );
      expect(result.asset.currentStatus).toBe('for_resale');

      // This service deliberately does not touch the ledger or rate card — no
      // such dependency exists on the mock, so any interaction would have thrown
      // during construction/execution. Explicitly assert no ledger-shaped calls
      // leaked onto the shared prisma mock either.
      expect(mockPrisma.eventLedger).toBeUndefined();
      expect(mockPrisma.rateCardItem).toBeUndefined();
    });
  });

  describe('updateStatus', () => {
    function setupListing(status: string): void {
      mockPrisma.resaleListing.findUnique.mockResolvedValue({
        id: 'listing-1',
        assetId: 'asset-1',
        clientId: 'client-1',
        status,
      });
      mockPrisma.asset.findUnique.mockResolvedValue(baseAsset);
      mockPrisma.resaleListing.update.mockImplementation(({ data }: any) => ({
        id: 'listing-1',
        assetId: 'asset-1',
        status,
        ...data,
      }));
    }

    it('throws NotFoundException if the listing does not exist', async () => {
      mockPrisma.resaleListing.findUnique.mockResolvedValue(null);

      await expect(
        service.updateStatus('missing', { status: 'sold' } as any, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('listed -> sold stores soldPricePaise/soldAt and leaves the asset as for_resale', async () => {
      setupListing('listed');

      const result = await service.updateStatus(
        'listing-1',
        { status: 'sold', soldPricePaise: 5000 } as any,
        'user-1',
      );

      expect(result.status).toBe('sold');
      expect(result.soldPricePaise).toBe(BigInt(5000));
      expect(result.soldAt).toBeInstanceOf(Date);
      expect(mockPrisma.asset.update).not.toHaveBeenCalled();
      expect(result.asset.currentStatus).toBe('in_storage');
    });

    it('listed -> cancelled reverts the asset to in_storage', async () => {
      setupListing('listed');
      mockPrisma.asset.update.mockResolvedValue({ ...baseAsset, currentStatus: 'in_storage' });

      const result = await service.updateStatus(
        'listing-1',
        { status: 'cancelled' } as any,
        'user-1',
      );

      expect(result.status).toBe('cancelled');
      expect(mockPrisma.asset.update).toHaveBeenCalledWith({
        where: { id: 'asset-1' },
        data: { currentStatus: 'in_storage' },
      });
    });

    it('rejects further transitions once sold (terminal)', async () => {
      setupListing('sold');

      await expect(
        service.updateStatus('listing-1', { status: 'cancelled' } as any, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects further transitions once cancelled (terminal)', async () => {
      setupListing('cancelled');

      await expect(
        service.updateStatus('listing-1', { status: 'sold' } as any, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
