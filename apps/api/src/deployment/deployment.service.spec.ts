/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks intentionally use loose
   typing rather than duplicating full Prisma/service signatures */
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DeploymentService } from './deployment.service';
import { AssetStatusHistoryService } from '../asset-status-history/asset-status-history.service';
import type { CreateDeploymentOrderDto } from './dto/create-deployment-order.dto';

describe('DeploymentService', () => {
  let mockPrisma: any;
  let mockLedger: { create: jest.Mock };
  let mockRateCard: { findEffectiveAt: jest.Mock };
  let mockAudit: { log: jest.Mock };
  let mockCourierZone: { resolveZone: jest.Mock };
  let service: DeploymentService;

  const baseAsset = {
    id: 'asset-1',
    clientId: 'client-1',
    currentStatus: 'in_storage',
  };

  const baseDto: CreateDeploymentOrderDto = {
    clientId: 'client-1',
    assetIds: ['asset-1'],
    bundleType: 'standard',
    deliveryAddress: {
      line1: '1 Main St',
      city: 'Ahmedabad',
      state: 'Gujarat',
      pincode: '380001',
    },
    contactName: 'John Doe',
    contactPhone: '9999999999',
    requiresLabeling: false,
    requiresRepacking: false,
    clientTicketNumber: 'CL-1000',
  };

  beforeEach(() => {
    mockPrisma = {
      asset: {
        findMany: jest.fn().mockResolvedValue([baseAsset]),
        update: jest.fn().mockResolvedValue({}),
      },
      deploymentOrder: {
        findUnique: jest.fn(),
        create: jest
          .fn()
          .mockImplementation((args) =>
            Promise.resolve({ id: 'order-1', ...args.data, asset: baseAsset, endUser: null }),
          ),
        update: jest.fn(),
      },
      eventLedger: {
        findMany: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockResolvedValue([]),
      },
      eventSuppression: {
        create: jest.fn().mockReturnValue({ catch: jest.fn() }),
      },
      assetStatusHistory: {
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((cb) => cb(mockPrisma)),
    };
    mockLedger = { create: jest.fn().mockResolvedValue({ id: 'ledger-1' }) };
    mockRateCard = { findEffectiveAt: jest.fn().mockResolvedValue({ unitRatePaise: BigInt(500) }) };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    mockCourierZone = { resolveZone: jest.fn().mockResolvedValue('intra_state') };

    service = new DeploymentService(
      mockPrisma,
      mockLedger as any,
      mockRateCard as any,
      mockAudit as any,
      mockCourierZone as any,
      new AssetStatusHistoryService(mockPrisma),
    );
  });

  describe('create', () => {
    it('throws NotFoundException if the asset does not exist', async () => {
      mockPrisma.asset.findMany.mockResolvedValue([]);

      await expect(service.create(baseDto, 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if the asset belongs to a different client', async () => {
      mockPrisma.asset.findMany.mockResolvedValue([{ ...baseAsset, clientId: 'other-client' }]);

      await expect(service.create(baseDto, 'user-1')).rejects.toThrow(BadRequestException);
    });

    it('creates the deployment order, marks the asset deployed, and logs an audit entry when the asset belongs to the requested client', async () => {
      const result = await service.create(baseDto, 'user-1');

      expect(mockPrisma.deploymentOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            clientId: 'client-1',
            assetId: 'asset-1',
            status: 'pending',
          }),
        }),
      );
      expect(mockPrisma.asset.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'asset-1' },
          data: expect.objectContaining({ currentStatus: 'deployed' }),
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'deployment.create', entityId: 'order-1' }),
      );
      expect(result.id).toBe('order-1');
    });

    it('posts one manual transport charge for the shipment and bundle/labeling/repacking per asset', async () => {
      const assets = ['asset-1', 'asset-2', 'asset-3'].map((id) => ({ ...baseAsset, id }));
      mockPrisma.asset.findMany.mockResolvedValue(assets);

      await service.create(
        {
          ...baseDto,
          assetIds: assets.map((a) => a.id),
          requiresLabeling: true,
          requiresRepacking: true,
          transportChargePaise: 275050,
        },
        'user-1',
      );

      const types = mockLedger.create.mock.calls.map((c) => c[0].eventType as string);
      expect(types.filter((t) => t === 'TRANSPORT')).toHaveLength(1);
      expect(types.some((t) => t.startsWith('COURIER_'))).toBe(false);
      const transport = mockLedger.create.mock.calls.find(
        (c) => c[0].eventType === 'TRANSPORT',
      )![0];
      expect(transport.amountPaise).toBe(BigInt(275050));
      expect(types.filter((t) => t === 'PICK_PACK')).toHaveLength(3);
      expect(types.filter((t) => t === 'LABELING')).toHaveLength(3);
      expect(types.filter((t) => t === 'REPACKING')).toHaveLength(3);
      expect(mockPrisma.asset.update).toHaveBeenCalledTimes(3);
      expect(mockPrisma.deploymentOrder.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assetId: 'asset-1',
            items: {
              create: [{ assetId: 'asset-1' }, { assetId: 'asset-2' }, { assetId: 'asset-3' }],
            },
          }),
        }),
      );
    });

    it('posts no transport charge when no amount is entered', async () => {
      await service.create(baseDto, 'user-1');

      const types = mockLedger.create.mock.calls.map((c) => c[0].eventType as string);
      expect(types).not.toContain('TRANSPORT');
      expect(types.some((t) => t.startsWith('COURIER_'))).toBe(false);
    });

    it('rejects the whole order if any one asset belongs to another client', async () => {
      mockPrisma.asset.findMany.mockResolvedValue([
        baseAsset,
        { ...baseAsset, id: 'asset-2', clientId: 'other-client' },
      ]);

      await expect(
        service.create({ ...baseDto, assetIds: ['asset-1', 'asset-2'] }, 'user-1'),
      ).rejects.toThrow(BadRequestException);

      expect(mockPrisma.deploymentOrder.create).not.toHaveBeenCalled();
      expect(mockLedger.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException if any requested asset is missing', async () => {
      await expect(
        service.create({ ...baseDto, assetIds: ['asset-1', 'asset-2'] }, 'user-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('never reaches the asset/ledger writes when the client mismatch is caught', async () => {
      mockPrisma.asset.findMany.mockResolvedValue([{ ...baseAsset, clientId: 'other-client' }]);

      await expect(service.create(baseDto, 'user-1')).rejects.toThrow(BadRequestException);

      expect(mockPrisma.deploymentOrder.create).not.toHaveBeenCalled();
      expect(mockPrisma.asset.update).not.toHaveBeenCalled();
      expect(mockLedger.create).not.toHaveBeenCalled();
    });
  });
  describe('updateTransportCharge', () => {
    const order = { id: 'order-1', clientId: 'client-1', assetId: 'asset-1', status: 'delivered' };

    function existingTransport(paise: number): void {
      mockPrisma.eventLedger.groupBy.mockResolvedValue([
        { referenceId: 'order-1', _sum: { amountPaise: BigInt(paise) } },
      ]);
    }

    beforeEach(() => {
      mockPrisma.deploymentOrder.findUnique.mockResolvedValue(order);
    });

    it('posts the whole amount as a new transport charge when none was entered at creation', async () => {
      await service.updateTransportCharge('order-1', 275050, 'user-1');

      expect(mockLedger.create).toHaveBeenCalledTimes(1);
      expect(mockLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'TRANSPORT',
          amountPaise: BigInt(275050),
          referenceId: 'order-1',
          referenceType: 'deployment_order',
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'deployment.updateTransportCharge' }),
      );
    });

    it('posts only the difference when raising an existing charge', async () => {
      existingTransport(150000);

      await service.updateTransportCharge('order-1', 200000, 'user-1');

      expect(mockLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({ amountPaise: BigInt(50000) }),
      );
    });

    it('posts a negative adjustment when lowering a charge', async () => {
      existingTransport(150000);

      await service.updateTransportCharge('order-1', 100000, 'user-1');

      expect(mockLedger.create).toHaveBeenCalledWith(
        expect.objectContaining({ amountPaise: BigInt(-50000) }),
      );
    });

    it('does nothing when the amount is unchanged', async () => {
      existingTransport(150000);

      await service.updateTransportCharge('order-1', 150000, 'user-1');

      expect(mockLedger.create).not.toHaveBeenCalled();
      expect(mockAudit.log).not.toHaveBeenCalled();
    });

    it('rejects a cancelled order', async () => {
      mockPrisma.deploymentOrder.findUnique.mockResolvedValue({ ...order, status: 'cancelled' });

      await expect(service.updateTransportCharge('order-1', 1000, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockLedger.create).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for an unknown order', async () => {
      mockPrisma.deploymentOrder.findUnique.mockResolvedValue(null);

      await expect(service.updateTransportCharge('nope', 1000, 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
