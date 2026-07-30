import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { RateCardService } from '../rate-card/rate-card.service';
import { AuditService } from '../audit/audit.service';
import { DeploymentService } from '../deployment/deployment.service';
import type { CreateInspectionDto } from './dto/create-inspection.dto';
import type { CompleteInspectionDto } from './dto/complete-inspection.dto';
import type { CreateDeploymentOrderDto } from '../deployment/dto/create-deployment-order.dto';
import { businessMinutesBetween, addBusinessMinutes } from '../common/business-hours.util';

@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rateCard: RateCardService,
    private readonly audit: AuditService,
    private readonly deployment: DeploymentService,
  ) {}

  /**
   * Best-effort damage signal from the completed checklist. Assumption
   * (pending Esevel/Divya confirmation): grade 'D' or a failed screen/
   * power-on/battery check counts as damage found.
   */
  private isDamageFound(dto: CompleteInspectionDto): boolean {
    return dto.conditionGrade === 'D' || !dto.screenOk || !dto.powersOnOk || !dto.batteryCharges;
  }

  /**
   * When this inspection was auto-created by a retrieval's "received" step,
   * report the diagnostic outcome back: flag damage (placeholder for a real
   * alert channel — audit log only for now), or for a clean Full Cycle
   * retrieval, auto-create the redeploy Deployment order.
   */
  private async handleRetrievalDiagnosticOutcome(
    sourceRetrievalId: string,
    dto: CompleteInspectionDto,
    completedByUserId: string,
  ): Promise<void> {
    const damageFound = this.isDamageFound(dto);
    const retrieval = await this.prisma.retrievalRequest.update({
      where: { id: sourceRetrievalId },
      data: { damageFound },
    });

    if (damageFound) {
      await this.audit.log({
        userId: completedByUserId,
        action: 'retrieval.damageAlert',
        entity: 'RetrievalRequest',
        entityId: retrieval.id,
        newValue: { damageFound: true },
      });
      return;
    }

    if (retrieval.bundleType !== 'full_cycle' || retrieval.status === 'completed') {
      return;
    }

    // Redeploy destination fields are only conditionally validated at
    // creation time (bundleType === 'full_cycle') — a retrieval created
    // before that validation existed, or via any path that bypassed it,
    // could reach here with incomplete data. Skip and log rather than
    // silently creating a deployment order with a missing address or blank
    // contact info.
    if (
      !retrieval.redeployDeliveryAddress ||
      !retrieval.redeployContactName ||
      !retrieval.redeployContactPhone
    ) {
      await this.audit.log({
        userId: completedByUserId,
        action: 'retrieval.autoRedeploySkippedIncompleteData',
        entity: 'RetrievalRequest',
        entityId: retrieval.id,
        newValue: {
          hasAddress: !!retrieval.redeployDeliveryAddress,
          hasContactName: !!retrieval.redeployContactName,
          hasContactPhone: !!retrieval.redeployContactPhone,
        },
      });
      return;
    }

    try {
      await this.deployment.create(
        {
          clientId: retrieval.clientId,
          assetId: retrieval.assetId,
          endUserId: retrieval.redeployEndUserId ?? undefined,
          bundleType: retrieval.requiresRedeploySetup ? 'full_prep' : 'standard',
          deliveryAddress:
            retrieval.redeployDeliveryAddress as unknown as CreateDeploymentOrderDto['deliveryAddress'],
          contactName: retrieval.redeployContactName ?? '',
          contactPhone: retrieval.redeployContactPhone ?? '',
        } as CreateDeploymentOrderDto,
        completedByUserId,
      );
      await this.prisma.retrievalRequest.update({
        where: { id: retrieval.id },
        data: { status: 'completed', completedAt: new Date() },
      });
      await this.audit.log({
        userId: completedByUserId,
        action: 'retrieval.autoRedeploy',
        entity: 'RetrievalRequest',
        entityId: retrieval.id,
        newValue: { autoRedeployed: true },
      });
    } catch (err) {
      await this.audit.log({
        userId: completedByUserId,
        action: 'retrieval.autoRedeployFailed',
        entity: 'RetrievalRequest',
        entityId: retrieval.id,
        newValue: { error: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private getHolidaySet(): Set<string> {
    return new Set<string>();
  }

  findAll(
    clientId?: string,
    status?: string,
  ): Prisma.PrismaPromise<
    Prisma.InspectionGetPayload<{ include: { asset: true; photos: true } }>[]
  > {
    return this.prisma.inspection.findMany({
      where: {
        ...(clientId ? { asset: { clientId } } : {}),
        ...(status ? { status: status as never } : {}),
      },
      include: { asset: true, photos: true },
      orderBy: { startedAt: 'desc' },
    });
  }

  async findOne(
    id: string,
  ): Promise<Prisma.InspectionGetPayload<{ include: { asset: true; photos: true } }>> {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id },
      include: { asset: true, photos: true },
    });
    if (!inspection) throw new NotFoundException(`Inspection ${id} not found`);
    return inspection;
  }

  async create(
    dto: CreateInspectionDto,
    startedByUserId: string,
    requestingClientId?: string,
  ): Promise<Prisma.InspectionGetPayload<{ include: { asset: true } }>> {
    const asset = await this.prisma.asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new NotFoundException(`Asset ${dto.assetId} not found`);

    if (requestingClientId && asset.clientId !== requestingClientId) {
      throw new ForbiddenException('Cannot create an inspection for an asset from another client');
    }

    const open = await this.prisma.inspection.findFirst({
      where: { assetId: dto.assetId, status: 'in_progress' },
    });
    if (open) throw new BadRequestException('Asset already has an open inspection');

    const holidays = this.getHolidaySet();
    const slaTargetAt = addBusinessMinutes(new Date(), 1440, holidays);

    const inspection = await this.prisma.inspection.create({
      data: {
        assetId: dto.assetId,
        type: dto.type,
        startedAt: new Date(),
        startedByUserId,
        assignedToUserId: dto.assignedToUserId,
        status: 'in_progress',
        slaTargetAt,
      },
      include: { asset: true },
    });

    await this.audit.log({
      userId: startedByUserId,
      action: 'inspection.create',
      entity: 'Inspection',
      entityId: inspection.id,
      newValue: { assetId: dto.assetId, type: dto.type, status: 'in_progress' },
    });

    return inspection;
  }

  async cancel(
    id: string,
    cancelledByUserId: string,
  ): Promise<Prisma.InspectionGetPayload<{ include: { asset: true; photos: true } }>> {
    const inspection = await this.findOne(id);
    if (inspection.status !== 'in_progress') {
      throw new BadRequestException('Only in-progress inspections can be cancelled');
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.inspection.update({
        where: { id },
        data: {
          status: 'cancelled',
          completedAt: new Date(),
          completedByUserId: cancelledByUserId,
        },
        include: { asset: true, photos: true },
      });

      // Revert the asset back to in_storage (or whatever it was before inspection started)
      await tx.asset.update({
        where: { id: inspection.assetId },
        data: { currentStatus: 'in_storage' },
      });

      await this.audit.log({
        userId: cancelledByUserId,
        action: 'inspection.cancel',
        entity: 'Inspection',
        entityId: id,
        oldValue: { status: 'in_progress' },
        newValue: { status: 'cancelled' },
      });

      return updated;
    });
  }

  async complete(
    id: string,
    dto: CompleteInspectionDto,
    completedByUserId: string,
  ): Promise<Prisma.InspectionGetPayload<{ include: { asset: true; photos: true } }>> {
    const inspection = await this.findOne(id);
    if (inspection.status !== 'in_progress') {
      throw new BadRequestException('Inspection is not in progress');
    }

    // Require at least one photo
    const photoCount = await this.prisma.inspectionPhoto.count({
      where: { inspectionId: id },
    });
    const incomingPhotos = dto.photoKeys?.length ?? 0;
    if (photoCount + incomingPhotos < 1) {
      throw new BadRequestException('At least one photo is required to complete an inspection');
    }

    const completedAt = new Date();
    const holidays = this.getHolidaySet();
    const slaMinutes = businessMinutesBetween(inspection.startedAt, completedAt, holidays);

    const rate = await this.rateCard.findEffectiveAt('INSPECT', completedAt);
    const unitRate = rate ? rate.unitRatePaise : BigInt(0);

    const updatedInspection = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.inspection.update({
        where: { id },
        data: {
          completedAt,
          completedByUserId,
          status: 'completed',
          conditionGrade: dto.conditionGrade,
          scratchesOnCasing: dto.scratchesOnCasing,
          lidClosingOk: dto.lidClosingOk,
          scratchesOnScreen: dto.scratchesOnScreen,
          keyboardIssues: dto.keyboardIssues,
          missingFeet: dto.missingFeet,
          chargerDamage: dto.chargerDamage,
          allAccessoriesPresent: dto.allAccessoriesPresent,
          webcamOk: dto.webcamOk,
          speakersOk: dto.speakersOk,
          bluetoothOk: dto.bluetoothOk,
          batteryCharges: dto.batteryCharges,
          screenOk: dto.screenOk,
          keyboardOk: dto.keyboardOk,
          trackpadOk: dto.trackpadOk,
          portsOk: dto.portsOk,
          powersOnOk: dto.powersOnOk,
          imagesUploaded: dto.imagesUploaded,
          sanitization: dto.sanitization ?? null,
          factoryReset: dto.factoryReset ?? null,
          notes: dto.notes,
          slaMinutes,
        },
        include: { asset: true, photos: true },
      });

      if (dto.photoKeys && dto.photoKeys.length > 0) {
        await tx.inspectionPhoto.createMany({
          data: dto.photoKeys.map((s3Key) => ({ inspectionId: id, s3Key })),
        });
      }

      await tx.asset.update({
        where: { id: inspection.assetId },
        data: { conditionGrade: dto.conditionGrade, currentStatus: 'in_storage' },
      });

      await this.ledger.create({
        eventType: 'INSPECT',
        asset: { connect: { id: inspection.assetId } },
        client: { connect: { id: inspection.asset.clientId } },
        quantity: 1,
        unitRatePaise: unitRate,
        amountPaise: unitRate,
        occurredAt: completedAt,
        createdBy: completedByUserId,
        referenceId: id,
        referenceType: 'inspection',
      });

      await this.audit.log({
        userId: completedByUserId,
        action: 'inspection.complete',
        entity: 'Inspection',
        entityId: id,
        oldValue: { status: 'in_progress' },
        newValue: { status: 'completed', conditionGrade: dto.conditionGrade },
      });

      return updated;
    });

    if (updatedInspection.sourceRetrievalId) {
      await this.handleRetrievalDiagnosticOutcome(
        updatedInspection.sourceRetrievalId,
        dto,
        completedByUserId,
      );
    }

    return updatedInspection;
  }
}
