/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks intentionally use loose
   typing rather than duplicating full Prisma/service signatures */
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DisposalService } from './disposal.service';
import { AssetStatusHistoryService } from '../asset-status-history/asset-status-history.service';

describe('DisposalService', () => {
  let mockPrisma: any;
  let mockLedger: { create: jest.Mock };
  let mockRateCard: { findEffectiveAt: jest.Mock };
  let mockAudit: { log: jest.Mock };
  let service: DisposalService;

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
        update: jest.fn(),
      },
      disposalRequest: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      assetStatusHistory: {
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((cb) => cb(mockPrisma)),
    };
    mockLedger = { create: jest.fn().mockResolvedValue({ id: 'ledger-1' }) };
    mockRateCard = { findEffectiveAt: jest.fn() };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };

    service = new DisposalService(
      mockPrisma,
      mockLedger as any,
      mockRateCard as any,
      mockAudit as any,
      new AssetStatusHistoryService(mockPrisma),
    );
  });

  describe('create', () => {
    const baseDto = {
      clientId: 'client-1',
      assetId: 'asset-1',
      disposalType: 'non_certified' as const,
    };

    it('throws NotFoundException if the asset does not exist', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue(null);

      await expect(service.create(baseDto as any, 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if the asset belongs to a different client', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue({ ...baseAsset, clientId: 'other-client' });

      await expect(service.create(baseDto as any, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException if the asset is not in_storage', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue({ ...baseAsset, currentStatus: 'deployed' });

      await expect(service.create(baseDto as any, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('creates the disposal request with status pending and logs an audit entry', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue(baseAsset);
      mockPrisma.disposalRequest.create.mockResolvedValue({
        id: 'disposal-1',
        assetId: 'asset-1',
        status: 'pending',
      });

      const result = await service.create(baseDto as any, 'user-1');

      expect(mockPrisma.disposalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clientId: 'client-1',
            assetId: 'asset-1',
            disposalType: 'non_certified',
            status: 'pending',
            createdByUserId: 'user-1',
          }),
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'disposal.create', entityId: 'disposal-1' }),
      );
      expect(result.id).toBe('disposal-1');
    });

    it('forces requiresCertification to false for certified_blanco even if the caller requested it', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue(baseAsset);
      mockPrisma.disposalRequest.create.mockResolvedValue({
        id: 'disposal-2',
        assetId: 'asset-1',
        status: 'pending',
      });

      await service.create(
        { ...baseDto, disposalType: 'certified_blanco', requiresCertification: true } as any,
        'user-1',
      );

      expect(mockPrisma.disposalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ requiresCertification: false }),
        }),
      );
    });

    it('persists requiresCertification true as-is for non_certified', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue(baseAsset);
      mockPrisma.disposalRequest.create.mockResolvedValue({
        id: 'disposal-3',
        assetId: 'asset-1',
        status: 'pending',
      });

      await service.create(
        { ...baseDto, disposalType: 'non_certified', requiresCertification: true } as any,
        'user-1',
      );

      expect(mockPrisma.disposalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ requiresCertification: true }),
        }),
      );
    });

    it('persists requiresCertification true as-is for itad_bundled', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue(baseAsset);
      mockPrisma.disposalRequest.create.mockResolvedValue({
        id: 'disposal-4',
        assetId: 'asset-1',
        status: 'pending',
      });

      await service.create(
        { ...baseDto, disposalType: 'itad_bundled', requiresCertification: true } as any,
        'user-1',
      );

      expect(mockPrisma.disposalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ requiresCertification: true }),
        }),
      );
    });

    it('defaults requiresCertification to false when omitted', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue(baseAsset);
      mockPrisma.disposalRequest.create.mockResolvedValue({
        id: 'disposal-5',
        assetId: 'asset-1',
        status: 'pending',
      });

      await service.create(baseDto as any, 'user-1');

      expect(mockPrisma.disposalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ requiresCertification: false }),
        }),
      );
    });
  });

  describe('approve', () => {
    function setupDisposal(overrides: Record<string, unknown> = {}): void {
      mockPrisma.disposalRequest.findUnique.mockResolvedValue({
        id: 'disposal-1',
        assetId: 'asset-1',
        clientId: 'client-1',
        disposalType: 'non_certified',
        status: 'pending',
        requiresCertification: false,
        asset: baseAsset,
        ...overrides,
      });
      mockPrisma.disposalRequest.update.mockImplementation(({ data }: any) => ({
        id: 'disposal-1',
        assetId: 'asset-1',
        clientId: 'client-1',
        ...data,
      }));
    }

    it('throws NotFoundException if the disposal request does not exist', async () => {
      mockPrisma.disposalRequest.findUnique.mockResolvedValue(null);

      await expect(service.approve('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if the disposal request is not pending', async () => {
      setupDisposal({ status: 'approved' });

      await expect(service.approve('disposal-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('posts a base ledger event with the resolved rate and no cert add-on when requiresCertification is false', async () => {
      setupDisposal({ disposalType: 'non_certified', requiresCertification: false });
      mockRateCard.findEffectiveAt.mockResolvedValue({ unitRatePaise: BigInt(1000) });

      await service.approve('disposal-1', 'user-1');

      expect(mockRateCard.findEffectiveAt).toHaveBeenCalledTimes(1);
      expect(mockRateCard.findEffectiveAt).toHaveBeenCalledWith(
        'DISPOSAL_NON_CERT',
        expect.any(Date),
      );
      expect(mockLedger.create).toHaveBeenCalledTimes(1);
      expect(mockLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'DISPOSAL_NON_CERT',
          unitRatePaise: BigInt(1000),
          amountPaise: BigInt(1000),
          referenceId: 'disposal-1',
          referenceType: 'disposal',
        }),
      );
    });

    it('posts unitRatePaise/amountPaise of 0 for the base event when no rate is configured', async () => {
      setupDisposal({ disposalType: 'itad_bundled', requiresCertification: false });
      mockRateCard.findEffectiveAt.mockResolvedValue(null);

      await service.approve('disposal-1', 'user-1');

      expect(mockLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'DISPOSAL_ITAD',
          unitRatePaise: BigInt(0),
          amountPaise: BigInt(0),
        }),
      );
    });

    it('posts a second DISPOSAL_CERT_ADDON ledger event, resolved from its own rate lookup, when requiresCertification is true', async () => {
      setupDisposal({ disposalType: 'non_certified', requiresCertification: true });
      mockRateCard.findEffectiveAt.mockImplementation((code: string) => {
        if (code === 'DISPOSAL_NON_CERT') {
          return Promise.resolve({ unitRatePaise: BigInt(1000) });
        }
        if (code === 'DISPOSAL_CERT_ADDON') {
          return Promise.resolve({ unitRatePaise: BigInt(55000) });
        }
        return Promise.resolve(null);
      });

      await service.approve('disposal-1', 'user-1');

      expect(mockRateCard.findEffectiveAt).toHaveBeenCalledWith(
        'DISPOSAL_NON_CERT',
        expect.any(Date),
      );
      expect(mockRateCard.findEffectiveAt).toHaveBeenCalledWith(
        'DISPOSAL_CERT_ADDON',
        expect.any(Date),
      );
      expect(mockLedger.create).toHaveBeenCalledTimes(2);
      expect(mockLedger.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          eventType: 'DISPOSAL_NON_CERT',
          unitRatePaise: BigInt(1000),
          amountPaise: BigInt(1000),
        }),
      );
      expect(mockLedger.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          eventType: 'DISPOSAL_CERT_ADDON',
          unitRatePaise: BigInt(55000),
          amountPaise: BigInt(55000),
          referenceId: 'disposal-1',
          referenceType: 'disposal',
        }),
      );
    });

    it('posts the cert add-on event with unitRatePaise/amountPaise 0 when no DISPOSAL_CERT_ADDON rate is configured', async () => {
      setupDisposal({ disposalType: 'itad_bundled', requiresCertification: true });
      mockRateCard.findEffectiveAt.mockImplementation((code: string) => {
        if (code === 'DISPOSAL_ITAD') {
          return Promise.resolve({ unitRatePaise: BigInt(2000) });
        }
        return Promise.resolve(null);
      });

      await service.approve('disposal-1', 'user-1');

      expect(mockLedger.create).toHaveBeenCalledTimes(2);
      expect(mockLedger.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          eventType: 'DISPOSAL_CERT_ADDON',
          unitRatePaise: BigInt(0),
          amountPaise: BigInt(0),
        }),
      );
    });

    it('updates status to approved and logs an audit entry', async () => {
      setupDisposal();
      mockRateCard.findEffectiveAt.mockResolvedValue({ unitRatePaise: BigInt(1000) });

      const result = await service.approve('disposal-1', 'user-1');

      expect(mockPrisma.disposalRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'disposal-1' },
          data: expect.objectContaining({ status: 'approved', approvedByUserId: 'user-1' }),
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'disposal.approve', entityId: 'disposal-1' }),
      );
      expect(result.status).toBe('approved');
    });
  });

  describe('startProcessing', () => {
    it('throws NotFoundException if the disposal request does not exist', async () => {
      mockPrisma.disposalRequest.findUnique.mockResolvedValue(null);

      await expect(service.startProcessing('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if the disposal request is not approved', async () => {
      mockPrisma.disposalRequest.findUnique.mockResolvedValue({
        id: 'disposal-1',
        assetId: 'asset-1',
        status: 'pending',
        asset: baseAsset,
      });

      await expect(service.startProcessing('disposal-1', 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('moves the disposal request to in_progress and logs an audit entry', async () => {
      mockPrisma.disposalRequest.findUnique.mockResolvedValue({
        id: 'disposal-1',
        assetId: 'asset-1',
        status: 'approved',
        asset: baseAsset,
      });
      mockPrisma.disposalRequest.update.mockImplementation(({ data }: any) => ({
        id: 'disposal-1',
        assetId: 'asset-1',
        ...data,
      }));

      const result = await service.startProcessing('disposal-1', 'user-1');

      expect(mockPrisma.disposalRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'disposal-1' },
          data: expect.objectContaining({ status: 'in_progress' }),
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'disposal.startProcessing' }),
      );
      expect(result.status).toBe('in_progress');
    });
  });

  describe('complete', () => {
    it('throws NotFoundException if the disposal request does not exist', async () => {
      mockPrisma.disposalRequest.findUnique.mockResolvedValue(null);

      await expect(service.complete('missing', 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if the disposal request is not in_progress', async () => {
      mockPrisma.disposalRequest.findUnique.mockResolvedValue({
        id: 'disposal-1',
        assetId: 'asset-1',
        status: 'approved',
        asset: baseAsset,
      });

      await expect(service.complete('disposal-1', 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('marks the disposal completed, sets the asset to disposed, and logs an audit entry', async () => {
      mockPrisma.disposalRequest.findUnique.mockResolvedValue({
        id: 'disposal-1',
        assetId: 'asset-1',
        status: 'in_progress',
        asset: baseAsset,
      });
      mockPrisma.disposalRequest.update.mockImplementation(({ data }: any) => ({
        id: 'disposal-1',
        assetId: 'asset-1',
        ...data,
      }));
      mockPrisma.asset.update.mockResolvedValue({ ...baseAsset, currentStatus: 'disposed' });

      const result = await service.complete('disposal-1', 'user-1');

      expect(mockPrisma.disposalRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'disposal-1' },
          data: expect.objectContaining({ status: 'completed' }),
        }),
      );
      expect(mockPrisma.asset.update).toHaveBeenCalledWith({
        where: { id: 'asset-1' },
        data: { currentStatus: 'disposed' },
      });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'disposal.complete' }),
      );
      expect(result.status).toBe('completed');
    });
  });
});
