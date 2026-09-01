import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InspectionsService } from './inspections.service';
import { AssetStatusHistoryService } from '../asset-status-history/asset-status-history.service';
import type { CompleteInspectionDto } from './dto/complete-inspection.dto';
import type { CreateInspectionDto } from './dto/create-inspection.dto';

describe('InspectionsService', () => {
  let mockPrisma: {
    inspection: {
      findUnique: jest.Mock;
      update: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
    };
    inspectionPhoto: { count: jest.Mock; createMany: jest.Mock };
    asset: { findUnique: jest.Mock; update: jest.Mock };
    retrievalRequest: { update: jest.Mock };
    user: { findUnique: jest.Mock };
    assetDocument: { findFirst: jest.Mock; create: jest.Mock; update: jest.Mock };
    assetStatusHistory: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let mockLedger: { create: jest.Mock };
  let mockRateCard: { findEffectiveAt: jest.Mock };
  let mockAudit: { log: jest.Mock };
  let mockDeployment: { create: jest.Mock };
  let mockR2: { getStream: jest.Mock; upload: jest.Mock; delete: jest.Mock };
  let mockMail: { send: jest.Mock };
  let service: InspectionsService;

  const baseInspection = {
    id: 'inspection-1',
    assetId: 'asset-1',
    status: 'in_progress',
    startedAt: new Date('2026-07-01T05:00:00.000Z'),
    sourceRetrievalId: null as string | null,
    asset: { id: 'asset-1', clientId: 'client-1', currentStatus: 'in_inspection' },
    photos: [],
  };

  // All-clean checklist — no damage signal.
  const cleanDto: CompleteInspectionDto = {
    conditionGrade: 'A' as CompleteInspectionDto['conditionGrade'],
    clientTicketNumber: 'CL-1000',
    scratchesOnCasing: false,
    lidClosingOk: true,
    scratchesOnScreen: false,
    keyboardIssues: false,
    missingFeet: false,
    chargerDamage: false,
    acAdapterPresent: true,
    powerCablePresent: true,
    headsetPresent: true,
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
    operatingSystem: 'Windows 11 Pro 25H2',
    cpu: 'i3-13Gen',
    ram: '8GB',
    display: '13 inch',
    batteryHealth: 'Cycle count 92%',
    hardwareTestResult: 'Passed',
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
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest
          .fn()
          .mockImplementation((args) => Promise.resolve({ id: 'inspection-new', ...args.data })),
      },
      inspectionPhoto: {
        count: jest.fn().mockResolvedValue(3),
        createMany: jest.fn().mockResolvedValue({}),
      },
      asset: {
        findUnique: jest.fn().mockResolvedValue({ id: 'asset-1', clientId: 'client-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      retrievalRequest: {
        update: jest
          .fn()
          .mockImplementation((args) => Promise.resolve({ ...retrievalBase, ...args.data })),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ fullName: 'Inspector One' }),
      },
      assetDocument: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
      },
      assetStatusHistory: {
        create: jest.fn().mockResolvedValue({}),
      },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(mockPrisma)),
    };
    mockLedger = { create: jest.fn().mockResolvedValue({}) };
    mockRateCard = { findEffectiveAt: jest.fn().mockResolvedValue({ unitRatePaise: BigInt(500) }) };
    mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
    mockDeployment = { create: jest.fn().mockResolvedValue({}) };
    mockR2 = {
      getStream: jest.fn().mockResolvedValue(undefined),
      upload: jest.fn().mockResolvedValue(undefined),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    mockMail = { send: jest.fn().mockResolvedValue(undefined) };

    service = new InspectionsService(
      mockPrisma as unknown as ConstructorParameters<typeof InspectionsService>[0],
      mockLedger as unknown as ConstructorParameters<typeof InspectionsService>[1],
      mockRateCard as unknown as ConstructorParameters<typeof InspectionsService>[2],
      mockAudit as unknown as ConstructorParameters<typeof InspectionsService>[3],
      mockDeployment as unknown as ConstructorParameters<typeof InspectionsService>[4],
      mockR2 as unknown as ConstructorParameters<typeof InspectionsService>[5],
      new AssetStatusHistoryService(
        mockPrisma as unknown as ConstructorParameters<typeof AssetStatusHistoryService>[0],
      ),
      mockMail as unknown as ConstructorParameters<typeof InspectionsService>[7],
    );
  });

  describe('create', () => {
    const baseCreateDto: CreateInspectionDto = {
      assetId: 'asset-1',
      type: 'inbound' as CreateInspectionDto['type'],
    };

    it('throws NotFoundException if the asset does not exist', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue(null);

      await expect(service.create(baseCreateDto, 'user-1', 'client-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when the asset belongs to another client', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', clientId: 'other-client' });

      await expect(service.create(baseCreateDto, 'user-1', 'client-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('does not check ownership when requestingClientId is not provided (non-client-scoped caller)', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', clientId: 'other-client' });

      await expect(service.create(baseCreateDto, 'user-1')).resolves.toBeDefined();
    });

    it('creates the inspection and logs an audit entry when the asset belongs to the caller client', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', clientId: 'client-1' });

      const result = await service.create(baseCreateDto, 'user-1', 'client-1');

      expect(mockPrisma.inspection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ assetId: 'asset-1', status: 'in_progress' }),
        }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'inspection.create' }),
      );
      expect(result).toBeDefined();
    });

    it('throws BadRequestException when the asset already has an open inspection', async () => {
      mockPrisma.asset.findUnique.mockResolvedValue({ id: 'asset-1', clientId: 'client-1' });
      mockPrisma.inspection.findFirst.mockResolvedValue({ id: 'existing-inspection' });

      await expect(service.create(baseCreateDto, 'user-1', 'client-1')).rejects.toThrow(
        BadRequestException,
      );
    });
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

    it('throws BadRequestException with fewer than the required minimum of 3 photos', async () => {
      mockPrisma.inspection.findUnique.mockResolvedValue({
        ...baseInspection,
        sourceRetrievalId: null,
      });
      mockPrisma.inspectionPhoto.count.mockResolvedValue(1);

      await expect(
        service.complete('inspection-1', { ...cleanDto, photoKeys: ['photo-1'] }, 'user-1'),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows completion with exactly the required minimum of 3 photos', async () => {
      mockPrisma.inspection.findUnique.mockResolvedValue({
        ...baseInspection,
        sourceRetrievalId: null,
      });
      mockPrisma.inspectionPhoto.count.mockResolvedValue(0);

      await expect(
        service.complete(
          'inspection-1',
          { ...cleanDto, photoKeys: ['photo-1', 'photo-2', 'photo-3'] },
          'user-1',
        ),
      ).resolves.toBeDefined();
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

  describe('generateConditionReportPdf', () => {
    const completedInspection = {
      id: 'inspection-1',
      assetId: 'asset-1',
      status: 'completed',
      type: 'inbound',
      startedAt: new Date('2026-07-01T05:00:00.000Z'),
      completedAt: new Date('2026-07-01T06:00:00.000Z'),
      completedByUserId: 'user-2',
      conditionGrade: 'A',
      ivalueTicketNumber: '11250',
      clientTicketNumber: 'CL-9981',
      contactPerson: 'Franly Homo',
      contactNumber: 'franly@veremark.com',
      operatingSystem: 'Windows 11 Pro 25H2',
      cpu: 'i3-13Gen',
      ram: '8GB',
      display: '13 inch',
      batteryHealth: 'Cycle count 92%',
      hardwareTestResult: 'Passed',
      notes: 'All good',
      scratchesOnCasing: false,
      lidClosingOk: true,
      scratchesOnScreen: false,
      keyboardIssues: false,
      missingFeet: false,
      chargerDamage: false,
      acAdapterPresent: true,
      powerCablePresent: true,
      headsetPresent: true,
      otherAccessories: 'Webcam and Wireless Mouse',
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
      sanitization: null,
      factoryReset: null,
      photos: [],
      startedByUser: { fullName: 'Starter One' },
      asset: {
        id: 'asset-1',
        clientId: 'client-1',
        serialNumber: 'SN-001',
        assetTag: 'TAG-001',
        model: 'ThinkPad X1',
        manufacturer: 'Lenovo',
      },
    };

    it('throws NotFoundException when the inspection does not exist', async () => {
      mockPrisma.inspection.findUnique.mockResolvedValueOnce(null);
      await expect(service.generateConditionReportPdf('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ForbiddenException when the inspection belongs to another client', async () => {
      mockPrisma.inspection.findUnique.mockResolvedValueOnce(completedInspection);
      await expect(
        service.generateConditionReportPdf('inspection-1', 'other-client'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('throws BadRequestException when the inspection is not completed', async () => {
      mockPrisma.inspection.findUnique.mockResolvedValueOnce({
        ...completedInspection,
        status: 'in_progress',
      });
      await expect(service.generateConditionReportPdf('inspection-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('generates a PDF stream for a completed inspection the caller owns', async () => {
      mockPrisma.inspection.findUnique.mockResolvedValueOnce(completedInspection);
      const { stream, filename } = await service.generateConditionReportPdf(
        'inspection-1',
        'client-1',
      );
      expect(filename).toBe('condition-report-SN-001.pdf');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'user-2' } }),
      );

      const chunks: Buffer[] = [];
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(chunk as Buffer));
        stream.on('end', () => resolve());
        stream.on('error', reject);
      });
      expect(Buffer.concat(chunks).length).toBeGreaterThan(0);
    });

    it('does not persist a document when generatedByUserId is not supplied (e.g. client_user download)', async () => {
      mockPrisma.inspection.findUnique.mockResolvedValueOnce(completedInspection);
      await service.generateConditionReportPdf('inspection-1', 'client-1');
      expect(mockR2.upload).not.toHaveBeenCalled();
      expect(mockPrisma.assetDocument.create).not.toHaveBeenCalled();
    });

    it('creates a new AssetDocument on first generation when generatedByUserId is supplied', async () => {
      mockPrisma.inspection.findUnique.mockResolvedValueOnce(completedInspection);
      await service.generateConditionReportPdf('inspection-1', undefined, 'staff-1');

      expect(mockR2.upload).toHaveBeenCalledWith(
        'documents/inspections/condition-report-inspection-1.pdf',
        expect.any(Buffer),
        'application/pdf',
      );
      expect(mockPrisma.assetDocument.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assetId: 'asset-1',
            inspectionId: 'inspection-1',
            clientId: 'client-1',
            storagePath: 'documents/inspections/condition-report-inspection-1.pdf',
            uploadedByUserId: 'staff-1',
          }),
        }),
      );
      expect(mockPrisma.assetDocument.update).not.toHaveBeenCalled();
    });

    it('updates the existing AssetDocument on regeneration instead of creating a duplicate', async () => {
      mockPrisma.inspection.findUnique.mockResolvedValueOnce(completedInspection);
      mockPrisma.assetDocument.findFirst.mockResolvedValueOnce({ id: 'doc-1' });

      await service.generateConditionReportPdf('inspection-1', undefined, 'staff-1');

      expect(mockPrisma.assetDocument.create).not.toHaveBeenCalled();
      expect(mockPrisma.assetDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-1' },
          data: expect.objectContaining({ uploadedByUserId: 'staff-1' }),
        }),
      );
    });
  });

  describe('findAndNotifyBreachedInspections', () => {
    const breachedInspection = {
      id: 'inspection-breached',
      status: 'in_progress',
      slaTargetAt: new Date('2026-07-01T00:00:00.000Z'),
      slaBreachNotifiedAt: null,
      asset: { manufacturer: 'Acme', model: 'ModelX', serialNumber: 'SN-1' },
    };

    it('emails both SLA-breach recipients per breached inspection and marks it notified', async () => {
      mockPrisma.inspection.findMany.mockResolvedValue([breachedInspection]);

      const count = await service.findAndNotifyBreachedInspections();

      expect(count).toBe(1);
      expect(mockPrisma.inspection.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'in_progress',
            slaBreachNotifiedAt: null,
          }),
        }),
      );
      expect(mockMail.send).toHaveBeenCalledTimes(2);
      expect(mockMail.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'sales.bo@ivalueindia.com' }),
      );
      expect(mockMail.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'dhanesh@ivalueindia.com' }),
      );
      expect(mockPrisma.inspection.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inspection-breached' },
          data: expect.objectContaining({ slaBreachNotifiedAt: expect.any(Date) }),
        }),
      );
    });

    it('does nothing when there are no newly breached inspections', async () => {
      mockPrisma.inspection.findMany.mockResolvedValue([]);

      const count = await service.findAndNotifyBreachedInspections();

      expect(count).toBe(0);
      expect(mockMail.send).not.toHaveBeenCalled();
      expect(mockPrisma.inspection.update).not.toHaveBeenCalled();
    });
  });
});
