/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks intentionally use loose
   typing rather than duplicating full Prisma/service signatures */
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { DeploymentService } from './deployment.service';
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
    assetId: 'asset-1',
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
  };

  beforeEach(() => {
    mockPrisma = {
      asset: {
        findUnique: jest.fn().mockResolvedValue(baseAsset),
        update: jest.fn().mockResolvedValue({}),
      },
      deploymentOrder: {
        findUnique: jest.fn(),
        create: jest
          .fn()
          .mockImplementation((args) => Promise.resolve({ id: 'order-1', ...args.data })),
        update: jest.fn(),
      },
      eventLedger: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      eventSuppression: {
        create: jest.fn().mockReturnValue({ catch: jest.fn() }),
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
    );
  });

  describe('create', () => {
    it('throws NotFoundException if the asset does not exist', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue(null);

      await expect(service.create(baseDto, 'user-1')).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException if the asset belongs to a different client', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue({ ...baseAsset, clientId: 'other-client' });

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

    it('never reaches the asset/ledger writes when the client mismatch is caught', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue({ ...baseAsset, clientId: 'other-client' });

      await expect(service.create(baseDto, 'user-1')).rejects.toThrow(BadRequestException);

      expect(mockPrisma.deploymentOrder.create).not.toHaveBeenCalled();
      expect(mockPrisma.asset.update).not.toHaveBeenCalled();
      expect(mockLedger.create).not.toHaveBeenCalled();
    });
  });
});
