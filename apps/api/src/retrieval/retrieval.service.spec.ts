import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RetrievalService } from './retrieval.service';
import { AssetStatusHistoryService } from '../asset-status-history/asset-status-history.service';
import type { CreateRetrievalRequestDto } from './dto/create-retrieval-request.dto';
import type { UpdateRetrievalStatusDto } from './dto/update-retrieval-status.dto';

describe('RetrievalService', () => {
  let mockPrisma: {
    retrievalRequest: { create: jest.Mock; update: jest.Mock; findUnique: jest.Mock };
    asset: { findUnique: jest.Mock; update: jest.Mock };
    user: { findUnique: jest.Mock };
    inspection: { create: jest.Mock };
    assetStatusHistory: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let mockLedger: { create: jest.Mock };
  let mockRateCard: { findEffectiveAt: jest.Mock };
  let mockAudit: { log: jest.Mock };
  let mockCourierZone: { resolveZone: jest.Mock };
  let service: RetrievalService;

  const baseDto: CreateRetrievalRequestDto = {
    clientId: 'client-1',
    assetId: 'asset-1',
    bundleType: 'standard',
    pickupAddress: {
      line1: '1 Main St',
      city: 'Ahmedabad',
      state: 'Gujarat',
      pincode: '380001',
    },
    contactName: 'John Doe',
    contactPhone: '9999999999',
    requiresPostInspection: false,
    requiresWipe: false,
    requiresRedeploySetup: false,
    clientTicketNumber: 'CL-1000',
  };

  const existingRetrieval = {
    id: 'retrieval-1',
    assetId: 'asset-1',
    clientId: 'client-1',
    status: 'pending',
    createdByUserId: 'user-1',
    requiresPostInspection: false,
    asset: { id: 'asset-1', clientId: 'client-1', currentStatus: 'returning' },
  };

  beforeEach(() => {
    mockPrisma = {
      retrievalRequest: {
        create: jest.fn().mockResolvedValue({
          id: 'retrieval-1',
          asset: { id: 'asset-1', clientId: 'client-1', currentStatus: 'in_storage' },
        }),
        update: jest.fn().mockImplementation((args) => Promise.resolve({ id: args.where.id })),
        findUnique: jest.fn(),
      },
      asset: {
        findUnique: jest.fn().mockResolvedValue({ id: 'asset-1', clientId: 'client-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'user-1' }),
      },
      inspection: { create: jest.fn().mockResolvedValue({}) },
      assetStatusHistory: {
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(mockPrisma)),
    };
    mockLedger = { create: jest.fn().mockResolvedValue({}) };
    mockRateCard = { findEffectiveAt: jest.fn() };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    mockCourierZone = { resolveZone: jest.fn() };

    service = new RetrievalService(
      mockPrisma as unknown as ConstructorParameters<typeof RetrievalService>[0],
      mockLedger as unknown as ConstructorParameters<typeof RetrievalService>[1],
      mockRateCard as unknown as ConstructorParameters<typeof RetrievalService>[2],
      mockAudit as unknown as ConstructorParameters<typeof RetrievalService>[3],
      mockCourierZone as unknown as ConstructorParameters<typeof RetrievalService>[4],
      new AssetStatusHistoryService(
        mockPrisma as unknown as ConstructorParameters<typeof AssetStatusHistoryService>[0],
      ),
    );
  });

  describe('create', () => {
    it('throws NotFoundException if the asset does not exist', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue(null);

      await expect(service.create(baseDto, 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if the asset belongs to a different client', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', clientId: 'other-client' });

      await expect(service.create(baseDto, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it.each([
      ['intra_state', 'COURIER_CITY'],
      ['inter_state', 'COURIER_INTERSTATE'],
      ['rural', 'COURIER_RURAL'],
    ])('bills courier code %s -> %s based on resolved zone', async (zone, expectedCode) => {
      mockCourierZone.resolveZone.mockResolvedValue(zone);
      mockRateCard.findEffectiveAt.mockResolvedValue({ unitRatePaise: BigInt(500) });

      await service.create(baseDto, 'user-1');

      const courierLedgerCall = mockLedger.create.mock.calls.find(
        (call) => call[0].eventType === expectedCode,
      );
      expect(courierLedgerCall).toBeDefined();
      expect(mockRateCard.findEffectiveAt).toHaveBeenCalledWith(expectedCode, expect.any(Date));
    });

    it('bills RETRIEVAL for standard bundle type', async () => {
      mockCourierZone.resolveZone.mockResolvedValue('intra_state');
      mockRateCard.findEffectiveAt.mockResolvedValue({ unitRatePaise: BigInt(100) });

      await service.create({ ...baseDto, bundleType: 'standard' }, 'user-1');

      expect(mockRateCard.findEffectiveAt).toHaveBeenCalledWith('RETRIEVAL', expect.any(Date));
      const retrievalLedgerCall = mockLedger.create.mock.calls.find(
        (call) => call[0].eventType === 'RETRIEVAL',
      );
      expect(retrievalLedgerCall).toBeDefined();
    });

    it('bills RETRIEVAL_FULL_CYCLE for full_cycle bundle type', async () => {
      mockCourierZone.resolveZone.mockResolvedValue('intra_state');
      mockRateCard.findEffectiveAt.mockResolvedValue({ unitRatePaise: BigInt(100) });

      const fullCycleDto: CreateRetrievalRequestDto = {
        ...baseDto,
        bundleType: 'full_cycle',
        redeployEndUserId: 'end-user-1',
        redeployDeliveryAddress: {
          line1: 'New addr',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
        },
        redeployContactName: 'Jane Doe',
        redeployContactPhone: '8888888888',
      };

      await service.create(fullCycleDto, 'user-1');

      expect(mockRateCard.findEffectiveAt).toHaveBeenCalledWith(
        'RETRIEVAL_FULL_CYCLE',
        expect.any(Date),
      );
      const retrievalLedgerCall = mockLedger.create.mock.calls.find(
        (call) => call[0].eventType === 'RETRIEVAL_FULL_CYCLE',
      );
      expect(retrievalLedgerCall).toBeDefined();
    });

    it('persists the redeploy fields on tx.retrievalRequest.create', async () => {
      mockCourierZone.resolveZone.mockResolvedValue('intra_state');
      mockRateCard.findEffectiveAt.mockResolvedValue({ unitRatePaise: BigInt(100) });

      const fullCycleDto: CreateRetrievalRequestDto = {
        ...baseDto,
        bundleType: 'full_cycle',
        requiresWipe: true,
        requiresRedeploySetup: true,
        redeployEndUserId: 'end-user-1',
        redeployDeliveryAddress: {
          line1: 'New addr',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
        },
        redeployContactName: 'Jane Doe',
        redeployContactPhone: '8888888888',
      };

      await service.create(fullCycleDto, 'user-1');

      expect(mockPrisma.retrievalRequest.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            requiresWipe: true,
            requiresRedeploySetup: true,
            redeployEndUserId: 'end-user-1',
            redeployDeliveryAddress: fullCycleDto.redeployDeliveryAddress,
            redeployContactName: 'Jane Doe',
            redeployContactPhone: '8888888888',
          }),
        }),
      );
    });

    it("sets the asset's currentStatus to 'returning'", async () => {
      mockCourierZone.resolveZone.mockResolvedValue('intra_state');
      mockRateCard.findEffectiveAt.mockResolvedValue({ unitRatePaise: BigInt(100) });

      await service.create(baseDto, 'user-1');

      expect(mockPrisma.asset.update).toHaveBeenCalledWith({
        where: { id: baseDto.assetId },
        data: { currentStatus: 'returning' },
      });
    });

    it('falls back to BigInt(0) when no effective rate card entry exists', async () => {
      mockCourierZone.resolveZone.mockResolvedValue('intra_state');
      mockRateCard.findEffectiveAt.mockResolvedValue(null);

      await service.create(baseDto, 'user-1');

      for (const call of mockLedger.create.mock.calls) {
        expect(call[0].unitRatePaise).toBe(BigInt(0));
        expect(call[0].amountPaise).toBe(BigInt(0));
      }
    });
  });

  describe('updateStatus', () => {
    const setupRetrieval = (overrides: Partial<typeof existingRetrieval> = {}): void => {
      mockPrisma.retrievalRequest.findUnique.mockResolvedValue({
        ...existingRetrieval,
        ...overrides,
      });
    };

    it.each([
      ['pending', 'initiated'],
      ['pending', 'cancelled'],
      ['initiated', 'in_transit'],
      ['initiated', 'cancelled'],
      ['in_transit', 'received'],
      ['in_transit', 'cancelled'],
    ])('allows transition from %s to %s', async (fromStatus, toStatus) => {
      setupRetrieval({ status: fromStatus });
      const dto: UpdateRetrievalStatusDto = { status: toStatus as never };

      const result = await service.updateStatus('retrieval-1', dto, 'user-1');

      expect(result).toBeDefined();
    });

    it.each([
      ['pending', 'received'],
      ['pending', 'completed'],
      ['initiated', 'received'],
      ['received', 'initiated'],
      ['received', 'completed'],
      ['completed', 'initiated'],
      ['cancelled', 'initiated'],
    ])(
      'throws BadRequestException for invalid transition %s -> %s',
      async (fromStatus, toStatus) => {
        setupRetrieval({ status: fromStatus });
        const dto: UpdateRetrievalStatusDto = { status: toStatus as never };

        await expect(service.updateStatus('retrieval-1', dto, 'user-1')).rejects.toThrow(
          BadRequestException,
        );
      },
    );

    it('always creates an outbound Inspection and sets asset to in_inspection on transition to received, even when requiresPostInspection is false', async () => {
      setupRetrieval({ status: 'in_transit', requiresPostInspection: false });
      const dto: UpdateRetrievalStatusDto = { status: 'received' };

      await service.updateStatus('retrieval-1', dto, 'user-1');

      expect(mockPrisma.asset.update).toHaveBeenCalledWith({
        where: { id: 'asset-1' },
        data: { currentStatus: 'in_inspection' },
      });
      expect(mockPrisma.inspection.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          assetId: 'asset-1',
          sourceRetrievalId: 'retrieval-1',
          type: 'outbound',
          status: 'in_progress',
        }),
      });
    });

    it('does not create an inspection for transitions other than "received"', async () => {
      setupRetrieval({ status: 'pending', requiresPostInspection: false });
      const dto: UpdateRetrievalStatusDto = { status: 'initiated' };

      await service.updateStatus('retrieval-1', dto, 'user-1');

      expect(mockPrisma.inspection.create).not.toHaveBeenCalled();
    });
  });

  describe('updateZone', () => {
    it('updates courierZone and logs old/new values via audit.log', async () => {
      mockPrisma.retrievalRequest.findUnique.mockResolvedValue({
        ...existingRetrieval,
        courierZone: 'intra_state',
      });
      mockPrisma.retrievalRequest.update.mockResolvedValue({
        ...existingRetrieval,
        courierZone: 'inter_state',
      });

      const result = await service.updateZone('retrieval-1', 'inter_state', 'user-1');

      expect(mockPrisma.retrievalRequest.update).toHaveBeenCalledWith({
        where: { id: 'retrieval-1' },
        data: { courierZone: 'inter_state' },
        include: { asset: true },
      });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'retrieval.updateZone',
          entityId: 'retrieval-1',
          oldValue: { courierZone: 'intra_state' },
          newValue: { courierZone: 'inter_state' },
        }),
      );
      expect(result.courierZone).toBe('inter_state');
    });
  });
});
