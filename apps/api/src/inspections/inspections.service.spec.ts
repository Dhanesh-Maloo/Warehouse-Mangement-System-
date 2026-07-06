import { BadRequestException } from '@nestjs/common';
import { InspectionsService } from './inspections.service';
import type { CompleteInspectionDto } from './dto/complete-inspection.dto';

describe('InspectionsService', () => {
  let mockPrisma: {
    inspection: { findUnique: jest.Mock; update: jest.Mock };
    inspectionPhoto: { count: jest.Mock; createMany: jest.Mock };
    asset: { update: jest.Mock };
    retrievalRequest: { update: jest.Mock };
    $transaction: jest.Mock;
  };
  let mockLedger: { create: jest.Mock };
  let mockRateCard: { findEffectiveAt: jest.Mock };
  let mockAudit: { log: jest.Mock };
  let mockDeployment: { create: jest.Mock };
  let service: InspectionsService;

  const baseInspection = {
    id: 'inspection-1',
    assetId: 'asset-1',
    status: 'in_progress',
    startedAt: new Date('2026-07-01T05:00:00.000Z'),
    sourceRetrievalId: null as string | null,
    asset: { id: 'asset-1', clientId: 'client-1' },
    photos: [],
  };

  // All-clean checklist — no damage signal.
  const cleanDto: CompleteInspectionDto = {
    conditionGrade: 'A' as CompleteInspectionDto['conditionGrade'],
    scratchesOnCasing: false,
    lidClosingOk: true,
    scratchesOnScreen: false,
    keyboardIssues: false,
    missingFeet: false,
    chargerDamage: false,
    allAccessoriesPresent: true,
    webcamOk: true,
    speakersOk: true,
    bluetoothOk: true,
    batteryCharges: true,
    screenOk: true,
    keyboardOk: true,
    trackpadOk: true,
    portsOk: true,
    powersOnOk: true,
    imagesUploaded: true,
    photoKeys: ['photo-1'],
  };

  const retrievalBase = {
    id: 'retrieval-1',
    clientId: 'client-1',
    assetId: 'asset-1',
    bundleType: 'full_cycle',
    status: 'received',
    redeployEndUserId: 'end-user-1',
    redeployDeliveryAddress: {
      line1: 'New addr',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
    },
    redeployContactName: 'Jane Doe',
    redeployContactPhone: '8888888888',
    requiresRedeploySetup: false,
  };

  let currentInspection: typeof baseInspection;

  beforeEach(() => {
    currentInspection = { ...baseInspection };
    mockPrisma = {
      inspection: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(currentInspection)),
        update: jest.fn().mockImplementation((args) =>
          Promise.resolve({
            ...currentInspection,
            ...args.data,
            id: args.where.id,
          }),
        ),
      },
      inspectionPhoto: {
        count: jest.fn().mockResolvedValue(1),
        createMany: jest.fn().mockResolvedValue({}),
      },
      asset: { update: jest.fn().mockResolvedValue({}) },
      retrievalRequest: {
        update: jest
          .fn()
          .mockImplementation((args) => Promise.resolve({ ...retrievalBase, ...args.data })),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(mockPrisma)),
    };
    mockLedger = { create: jest.fn().mockResolvedValue({}) };
    mockRateCard = { findEffectiveAt: jest.fn().mockResolvedValue({ unitRatePaise: BigInt(500) }) };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    mockDeployment = { create: jest.fn().mockResolvedValue({}) };

    service = new InspectionsService(
      mockPrisma as unknown as ConstructorParameters<typeof InspectionsService>[0],
      mockLedger as unknown as ConstructorParameters<typeof InspectionsService>[1],
      mockRateCard as unknown as ConstructorParameters<typeof InspectionsService>[2],
      mockAudit as unknown as ConstructorParameters<typeof InspectionsService>[3],
      mockDeployment as unknown as ConstructorParameters<typeof InspectionsService>[4],
    );
  });

  describe('complete() — unrelated to retrieval', () => {
    it('completes normally, posts INSPECT ledger event, and does not touch retrieval or deployment', async () => {
      mockPrisma.inspection.findUnique.mockResolvedValue({
        ...baseInspection,
        sourceRetrievalId: null,
      });

      const result = await service.complete('inspection-1', cleanDto, 'user-1');

      expect(result.status).toBe('completed');
      const ledgerCall = mockLedger.create.mock.calls.find(
        (call) => call[0].eventType === 'INSPECT',
      );
      expect(ledgerCall).toBeDefined();
      expect(mockPrisma.retrievalRequest.update).not.toHaveBeenCalled();
      expect(mockDeployment.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when the inspection is not in progress', async () => {
      mockPrisma.inspection.findUnique.mockResolvedValue({
        ...baseInspection,
        status: 'completed',
      });

      await expect(service.complete('inspection-1', cleanDto, 'user-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('throws BadRequestException when there are no photos at all', async () => {
      mockPrisma.inspection.findUnique.mockResolvedValue({
        ...baseInspection,
        sourceRetrievalId: null,
      });
      mockPrisma.inspectionPhoto.count.mockResolvedValue(0);

      await expect(
        service.complete('inspection-1', { ...cleanDto, photoKeys: undefined }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('complete() — damage detection for retrieval-sourced inspections', () => {
    const withRetrievalSource = (): void => {
      currentInspection = { ...baseInspection, sourceRetrievalId: 'retrieval-1' };
    };

    it.each([
      ['conditionGrade D', { conditionGrade: 'D' as CompleteInspectionDto['conditionGrade'] }],
      ['screenOk false', { screenOk: false }],
      ['powersOnOk false', { powersOnOk: false }],
      ['batteryCharges false', { batteryCharges: false }],
    ])('flags damage when %s (all else clean)', async (_label, overrides) => {
      withRetrievalSource();
      const dto: CompleteInspectionDto = { ...cleanDto, ...overrides };

      await service.complete('inspection-1', dto, 'user-1');

      expect(mockPrisma.retrievalRequest.update).toHaveBeenCalledWith({
        where: { id: 'retrieval-1' },
        data: { damageFound: true },
      });
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'retrieval.damageAlert' }),
      );
      expect(mockDeployment.create).not.toHaveBeenCalled();
    });

    it('flags no damage in the all-clean case', async () => {
      withRetrievalSource();
      mockPrisma.retrievalRequest.update.mockResolvedValueOnce({
        ...retrievalBase,
        bundleType: 'standard',
        damageFound: false,
      });

      await service.complete('inspection-1', cleanDto, 'user-1');

      expect(mockPrisma.retrievalRequest.update).toHaveBeenCalledWith({
        where: { id: 'retrieval-1' },
        data: { damageFound: false },
      });
      expect(mockAudit.log).not.toHaveBeenCalledWith(
        expect.objectContaining({ action: 'retrieval.damageAlert' }),
      );
    });
  });

  describe('complete() — auto-redeploy for clean Full Cycle retrievals', () => {
    const withRetrievalSource = (): void => {
      currentInspection = { ...baseInspection, sourceRetrievalId: 'retrieval-1' };
    };

    it('does not auto-deploy when bundleType is not full_cycle', async () => {
      withRetrievalSource();
      mockPrisma.retrievalRequest.update.mockResolvedValueOnce({
        ...retrievalBase,
        bundleType: 'standard',
        damageFound: false,
      });

      await service.complete('inspection-1', cleanDto, 'user-1');

      expect(mockDeployment.create).not.toHaveBeenCalled();
    });

    it('does not auto-deploy and does not crash when redeployDeliveryAddress is null (legacy retrieval)', async () => {
      withRetrievalSource();
      mockPrisma.retrievalRequest.update.mockResolvedValueOnce({
        ...retrievalBase,
        bundleType: 'full_cycle',
        redeployDeliveryAddress: null,
        damageFound: false,
      });

      await expect(service.complete('inspection-1', cleanDto, 'user-1')).resolves.toBeDefined();
      expect(mockDeployment.create).not.toHaveBeenCalled();
    });

    it('auto-deploys with standard bundleType when requiresRedeploySetup is false, updates retrieval to completed, and logs autoRedeploy', async () => {
      withRetrievalSource();
      mockPrisma.retrievalRequest.update.mockResolvedValueOnce({
        ...retrievalBase,
        requiresRedeploySetup: false,
        damageFound: false,
      });

      await service.complete('inspection-1', cleanDto, 'user-1');

      expect(mockDeployment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          clientId: 'client-1',
          assetId: 'asset-1',
          endUserId: 'end-user-1',
          bundleType: 'standard',
          deliveryAddress: retrievalBase.redeployDeliveryAddress,
          contactName: 'Jane Doe',
          contactPhone: '8888888888',
        }),
        'user-1',
      );

      // second retrievalRequest.update call sets status completed
      expect(mockPrisma.retrievalRequest.update).toHaveBeenNthCalledWith(2, {
        where: { id: 'retrieval-1' },
        data: { status: 'completed', completedAt: expect.any(Date) },
      });

      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'retrieval.autoRedeploy' }),
      );
    });

    it('auto-deploys with full_prep bundleType when requiresRedeploySetup is true', async () => {
      withRetrievalSource();
      mockPrisma.retrievalRequest.update.mockResolvedValueOnce({
        ...retrievalBase,
        requiresRedeploySetup: true,
        damageFound: false,
      });

      await service.complete('inspection-1', cleanDto, 'user-1');

      expect(mockDeployment.create).toHaveBeenCalledWith(
        expect.objectContaining({ bundleType: 'full_prep' }),
        'user-1',
      );
    });

    it.each([
      ['redeployContactName', { redeployContactName: null }],
      ['redeployContactPhone', { redeployContactPhone: '' }],
    ])(
      'does not auto-deploy and logs autoRedeploySkippedIncompleteData when %s is missing',
      async (_label, overrides) => {
        withRetrievalSource();
        mockPrisma.retrievalRequest.update.mockResolvedValueOnce({
          ...retrievalBase,
          ...overrides,
          damageFound: false,
        });

        await service.complete('inspection-1', cleanDto, 'user-1');

        expect(mockDeployment.create).not.toHaveBeenCalled();
        expect(mockAudit.log).toHaveBeenCalledWith(
          expect.objectContaining({ action: 'retrieval.autoRedeploySkippedIncompleteData' }),
        );
      },
    );

    it('does not auto-deploy again when the retrieval is already completed (idempotency)', async () => {
      withRetrievalSource();
      mockPrisma.retrievalRequest.update.mockResolvedValueOnce({
        ...retrievalBase,
        status: 'completed',
        damageFound: false,
      });

      await service.complete('inspection-1', cleanDto, 'user-1');

      expect(mockDeployment.create).not.toHaveBeenCalled();
    });

    it('swallows deployment.create errors, logs autoRedeployFailed, and still returns the completed inspection', async () => {
      withRetrievalSource();
      mockPrisma.retrievalRequest.update.mockResolvedValueOnce({
        ...retrievalBase,
        damageFound: false,
      });
      mockDeployment.create.mockRejectedValue(new Error('no effective rate card for RETRIEVAL'));

      const result = await service.complete('inspection-1', cleanDto, 'user-1');

      expect(result.status).toBe('completed');
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'retrieval.autoRedeployFailed',
          newValue: expect.objectContaining({ error: 'no effective rate card for RETRIEVAL' }),
        }),
      );
      // status should NOT have been advanced to completed since deploy failed
      expect(mockPrisma.retrievalRequest.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: 'completed', completedAt: expect.any(Date) } }),
      );
    });
  });
});
