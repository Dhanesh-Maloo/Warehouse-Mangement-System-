import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { RateCardService } from '../rate-card/rate-card.service';
import { AuditService } from '../audit/audit.service';
import type { CreateInspectionDto } from './dto/create-inspection.dto';
import type { CompleteInspectionDto } from './dto/complete-inspection.dto';

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const BH_START_HOUR = 9;
const BH_END_HOUR = 18;

function businessMinutesBetween(start: Date, end: Date, holidays: Set<string>): number {
  let minutes = 0;
  const cursor = new Date(start);
  while (cursor < end) {
    const istDate = new Date(cursor.getTime() + IST_OFFSET_MS);
    const dayOfWeek = istDate.getUTCDay();
    const hour = istDate.getUTCHours();
    const dateKey = istDate.toISOString().slice(0, 10);
    if (
      dayOfWeek >= 1 &&
      dayOfWeek <= 5 &&
      hour >= BH_START_HOUR &&
      hour < BH_END_HOUR &&
      !holidays.has(dateKey)
    ) {
      minutes += 1;
    }
    cursor.setTime(cursor.getTime() + 60_000);
  }
  return minutes;
}

function addBusinessMinutes(start: Date, minutesToAdd: number, holidays: Set<string>): Date {
  let remaining = minutesToAdd;
  const cursor = new Date(start);
  while (remaining > 0) {
    cursor.setTime(cursor.getTime() + 60_000);
    const istDate = new Date(cursor.getTime() + IST_OFFSET_MS);
    const dayOfWeek = istDate.getUTCDay();
    const hour = istDate.getUTCHours();
    const dateKey = istDate.toISOString().slice(0, 10);
    if (
      dayOfWeek >= 1 &&
      dayOfWeek <= 5 &&
      hour >= BH_START_HOUR &&
      hour < BH_END_HOUR &&
      !holidays.has(dateKey)
    ) {
      remaining -= 1;
    }
  }
  return cursor;
}

@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rateCard: RateCardService,
    private readonly audit: AuditService,
  ) {}

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
  ): Promise<Prisma.InspectionGetPayload<{ include: { asset: true } }>> {
    const asset = await this.prisma.asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new NotFoundException(`Asset ${dto.assetId} not found`);

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

    return this.prisma.$transaction(async (tx) => {
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
  }
}
