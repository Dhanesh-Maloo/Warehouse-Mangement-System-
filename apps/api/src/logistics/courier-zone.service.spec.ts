/* eslint-disable @typescript-eslint/no-explicit-any -- test mocks intentionally use loose
   typing rather than duplicating full PrismaService/ConfigService signatures */
import { BadRequestException } from '@nestjs/common';
import { CourierZoneService } from './courier-zone.service';

describe('CourierZoneService', () => {
  let mockPrisma: {
    ruralPincode: {
      findUnique: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      delete: jest.Mock;
    };
  };
  let mockConfig: { get: jest.Mock };
  let service: CourierZoneService;

  beforeEach(() => {
    mockPrisma = {
      ruralPincode: {
        findUnique: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        delete: jest.fn(),
      },
    };
    mockConfig = { get: jest.fn() };
    service = new CourierZoneService(mockPrisma as any, mockConfig as any);
  });

  describe('resolveZone', () => {
    it.each(['12345', 'abcdef', ''])(
      'throws BadRequestException for invalid pincode %p',
      async (pincode) => {
        await expect(service.resolveZone(pincode)).rejects.toThrow(BadRequestException);
      },
    );

    it('returns rural when the pincode is on the rural list, even if it would otherwise be intra-state', async () => {
      mockPrisma.ruralPincode.findUnique.mockResolvedValue({ pincode: '380001' });
      mockConfig.get.mockReturnValue('Gujarat');

      const zone = await service.resolveZone('380001');

      expect(zone).toBe('rural');
      expect(mockConfig.get).not.toHaveBeenCalled();
    });

    it('returns intra_state when derived state matches configured warehouse state (case-insensitive)', async () => {
      mockPrisma.ruralPincode.findUnique.mockResolvedValue(null);
      mockConfig.get.mockReturnValue('gujarat');

      // '38' prefix -> Gujarat per PINCODE_PREFIX_TO_STATE
      const zone = await service.resolveZone('380001');

      expect(zone).toBe('intra_state');
    });

    it('returns inter_state when derived state differs from configured warehouse state', async () => {
      mockPrisma.ruralPincode.findUnique.mockResolvedValue(null);
      mockConfig.get.mockReturnValue('Maharashtra');

      // '38' prefix -> Gujarat, warehouse configured as Maharashtra
      const zone = await service.resolveZone('380001');

      expect(zone).toBe('inter_state');
    });

    it('throws BadRequestException when the pincode prefix is not in the map', async () => {
      mockPrisma.ruralPincode.findUnique.mockResolvedValue(null);
      mockConfig.get.mockReturnValue('Gujarat');

      await expect(service.resolveZone('990001')).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when WAREHOUSE_STATE is not configured', async () => {
      mockPrisma.ruralPincode.findUnique.mockResolvedValue(null);
      mockConfig.get.mockReturnValue(undefined);

      await expect(service.resolveZone('380001')).rejects.toThrow(BadRequestException);
    });
  });

  describe('addRuralPincode', () => {
    it('throws BadRequestException for a non-6-digit pincode', () => {
      expect(() => service.addRuralPincode('123', 'note', 'user-1')).toThrow(BadRequestException);
      expect(mockPrisma.ruralPincode.create).not.toHaveBeenCalled();
    });

    it('calls prisma.ruralPincode.create with the right data shape', () => {
      mockPrisma.ruralPincode.create.mockResolvedValue({ pincode: '380001' });

      service.addRuralPincode('380001', 'far village', 'user-1');

      expect(mockPrisma.ruralPincode.create).toHaveBeenCalledWith({
        data: { pincode: '380001', note: 'far village', createdByUser: 'user-1' },
      });
    });
  });

  describe('removeRuralPincode', () => {
    it('throws BadRequestException when the underlying delete fails', async () => {
      mockPrisma.ruralPincode.delete.mockRejectedValue(new Error('not found'));

      await expect(service.removeRuralPincode('999999')).rejects.toThrow(BadRequestException);
    });

    it('resolves when the delete succeeds', async () => {
      mockPrisma.ruralPincode.delete.mockResolvedValue({ pincode: '380001' });

      await expect(service.removeRuralPincode('380001')).resolves.toBeUndefined();
      expect(mockPrisma.ruralPincode.delete).toHaveBeenCalledWith({
        where: { pincode: '380001' },
      });
    });
  });
});
