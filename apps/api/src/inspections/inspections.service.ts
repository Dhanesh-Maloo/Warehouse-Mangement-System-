import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Readable } from 'stream';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { RateCardService } from '../rate-card/rate-card.service';
import { AuditService } from '../audit/audit.service';
import { DeploymentService } from '../deployment/deployment.service';
import { R2Service } from '../r2/r2.service';
import type { CreateInspectionDto } from './dto/create-inspection.dto';
import type { CompleteInspectionDto } from './dto/complete-inspection.dto';
import type { CreateDeploymentOrderDto } from '../deployment/dto/create-deployment-order.dto';
import { businessMinutesBetween, addBusinessMinutes } from '../common/business-hours.util';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit') as typeof import('pdfkit');

// Mirrors the checklist shown on the inspection detail page
// (apps/web/src/features/inspections/InspectionDetailPage.tsx) so the report
// wording matches what staff filled in on screen.
interface ChecklistItem {
  key: keyof CompleteInspectionDto;
  label: string;
  yesIsGood: boolean;
}

const CHECKLIST_SECTIONS: { title: string; items: ChecklistItem[] }[] = [
  {
    title: 'Physical Appearance',
    items: [
      {
        key: 'scratchesOnCasing',
        label: 'Visible scratches on the outer casing',
        yesIsGood: false,
      },
      { key: 'lidClosingOk', label: 'Lid closing properly (no gap at hinge)', yesIsGood: true },
      { key: 'scratchesOnScreen', label: 'Visible scratches on the screen', yesIsGood: false },
      {
        key: 'keyboardIssues',
        label: 'Loose, missing or unidentified keys on keyboard',
        yesIsGood: false,
      },
      { key: 'missingFeet', label: 'Missing rubber feet (bottom of laptop)', yesIsGood: false },
      {
        key: 'chargerDamage',
        label: 'Damage to adapter / charger (exposed wire, etc.)',
        yesIsGood: false,
      },
      {
        key: 'allAccessoriesPresent',
        label: 'Returned with all accessories (AC Adapter & Headset)',
        yesIsGood: true,
      },
    ],
  },
  {
    title: 'Functional Checks',
    items: [
      { key: 'webcamOk', label: 'Webcam in working condition', yesIsGood: true },
      { key: 'speakersOk', label: 'Speakers in working condition', yesIsGood: true },
      { key: 'bluetoothOk', label: 'Bluetooth in working condition', yesIsGood: true },
      { key: 'batteryCharges', label: 'Battery could be charged', yesIsGood: true },
      { key: 'screenOk', label: 'Screen fully lit with no missing pixels', yesIsGood: true },
      { key: 'keyboardOk', label: 'Keyboards in working condition', yesIsGood: true },
      { key: 'trackpadOk', label: 'Trackpad in working condition', yesIsGood: true },
      { key: 'portsOk', label: 'All ports in working condition', yesIsGood: true },
      { key: 'powersOnOk', label: 'Unit powered on without any hardware errors', yesIsGood: true },
      {
        key: 'imagesUploaded',
        label: 'Uploaded photos (top, bottom, front, etc.)',
        yesIsGood: true,
      },
    ],
  },
  {
    title: 'Process',
    items: [
      { key: 'sanitization', label: 'Sanitization', yesIsGood: true },
      { key: 'factoryReset', label: 'Factory Reset (done by User)', yesIsGood: true },
    ],
  },
];

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rateCard: RateCardService,
    private readonly audit: AuditService,
    private readonly deployment: DeploymentService,
    private readonly r2: R2Service,
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

  /**
   * Diagnostic condition report PDF — device identifiers, checklist results,
   * photos and inspector name, so Esevel has something to hand to the client
   * for every retrieval (US-INS-03). Generated on request rather than as a
   * background job, matching the existing GRN PDF pattern (no queue
   * infrastructure exists yet); the client-facing endpoint works the same
   * way either way. A copy is persisted as an AssetDocument (keyed by
   * inspection id, so re-generating overwrites rather than accumulating
   * duplicates) to satisfy the "stored, linked from inspection record" part
   * of the spec.
   */
  async generateConditionReportPdf(
    inspectionId: string,
    requestingClientId?: string,
    generatedByUserId?: string,
  ): Promise<{ stream: NodeJS.ReadableStream; filename: string }> {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id: inspectionId },
      include: { asset: true, photos: true, startedByUser: { select: { fullName: true } } },
    });
    if (!inspection) throw new NotFoundException(`Inspection ${inspectionId} not found`);
    if (requestingClientId && inspection.asset.clientId !== requestingClientId) {
      throw new ForbiddenException(
        'Cannot download a report for an inspection from another client',
      );
    }
    if (inspection.status !== 'completed') {
      throw new BadRequestException('Condition report is only available for completed inspections');
    }

    const inspector = inspection.completedByUserId
      ? await this.prisma.user.findUnique({
          where: { id: inspection.completedByUserId },
          select: { fullName: true },
        })
      : null;

    const photoBuffers: Buffer[] = [];
    for (const photo of inspection.photos) {
      try {
        const stream = await this.r2.getStream(photo.s3Key);
        photoBuffers.push(await streamToBuffer(stream));
      } catch {
        // Skip photos that failed to upload/have since been removed from storage
      }
    }

    const filename = `condition-report-${inspection.asset.serialNumber}.pdf`;
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('IValue WMS', 50, 50);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#666666')
      .text('Warehouse Management System', 50, 74);
    doc.fillColor('#000000').fontSize(18).font('Helvetica-Bold').text('Condition Report', 50, 100);

    // Metadata box
    doc.rect(50, 130, 495, 80).stroke('#cccccc');
    doc.fontSize(9).font('Helvetica-Bold').text('Serial number', 60, 140);
    doc.font('Helvetica').fontSize(12).text(inspection.asset.serialNumber, 60, 153);
    doc.fontSize(9).font('Helvetica-Bold').text('Model', 220, 140);
    doc
      .font('Helvetica')
      .fontSize(11)
      .text(`${inspection.asset.manufacturer} ${inspection.asset.model}`, 220, 153);
    doc.fontSize(9).font('Helvetica-Bold').text('Inspection date', 400, 140);
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(
        (inspection.completedAt ?? inspection.startedAt).toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          day: '2-digit',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
        400,
        153,
      );
    doc.fontSize(9).font('Helvetica-Bold').text('Asset tag', 60, 178);
    doc.font('Helvetica').text(inspection.asset.assetTag ?? '—', 60, 191);
    doc.fontSize(9).font('Helvetica-Bold').text('Inspection type', 220, 178);
    doc.font('Helvetica').text(inspection.type, 220, 191);
    doc.fontSize(9).font('Helvetica-Bold').text('Inspected by', 400, 178);
    doc.font('Helvetica').text(inspector?.fullName ?? inspection.startedByUser.fullName, 400, 191);

    // Condition grade
    let y = 225;
    if (inspection.conditionGrade) {
      doc
        .fontSize(9)
        .font('Helvetica-Bold')
        .fillColor('#000000')
        .text(`Condition grade: ${inspection.conditionGrade}`, 50, y);
      y += 20;
    }

    // Checklist
    for (const section of CHECKLIST_SECTIONS) {
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#1A2B3C').text(section.title, 50, y);
      y += 16;
      for (const item of section.items) {
        if (y > 730) {
          doc.addPage();
          y = 50;
        }
        const value = inspection[item.key as keyof typeof inspection] as boolean | null;
        const label =
          value === null
            ? 'N/A'
            : item.yesIsGood
              ? value
                ? 'OK'
                : 'Issue'
              : value
                ? 'Issue'
                : 'OK';
        const color = value === null ? '#888888' : label === 'OK' ? '#0a7d3f' : '#b91c1c';
        doc
          .fontSize(9)
          .font('Helvetica')
          .fillColor('#000000')
          .text(item.label, 60, y, { width: 400 });
        doc.font('Helvetica-Bold').fillColor(color).text(label, 470, y);
        y += 15;
      }
      y += 8;
    }

    if (inspection.notes) {
      if (y > 690) {
        doc.addPage();
        y = 50;
      }
      doc.fontSize(10).font('Helvetica-Bold').fillColor('#1A2B3C').text('Notes', 50, y);
      y += 16;
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#000000')
        .text(inspection.notes, 60, y, { width: 480 });
      y += 40;
    }

    // Photos
    let footerY = y + 20;
    if (photoBuffers.length > 0) {
      doc.addPage();
      doc
        .fontSize(10)
        .font('Helvetica-Bold')
        .fillColor('#1A2B3C')
        .text(`Photos (${photoBuffers.length})`, 50, 50);
      let px = 50;
      let py = 75;
      const size = 150;
      photoBuffers.forEach((buf, idx) => {
        if (idx > 0 && idx % 3 === 0) {
          px = 50;
          py += size + 15;
        }
        if (py + size > 780) {
          doc.addPage();
          px = 50;
          py = 50;
        }
        try {
          doc.image(buf, px, py, { fit: [size, size] });
        } catch {
          // Skip anything that isn't a valid image buffer
        }
        px += size + 15;
      });
      footerY = py + size + 20;
    }

    // Footer — placed right after the last content on whichever page it ended up on
    if (footerY > 770) {
      doc.addPage();
      footerY = 50;
    }
    doc
      .fontSize(8)
      .fillColor('#888888')
      .text(
        `Generated by IValue WMS · ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
        50,
        footerY,
        { align: 'center', width: 495 },
      );

    doc.end();
    const pdfBuffer = await streamToBuffer(doc);

    if (generatedByUserId) {
      const r2Key = `documents/inspections/condition-report-${inspection.id}.pdf`;
      await this.r2.upload(r2Key, pdfBuffer, 'application/pdf');
      const existing = await this.prisma.assetDocument.findFirst({
        where: { inspectionId: inspection.id, storagePath: r2Key },
      });
      if (existing) {
        await this.prisma.assetDocument.update({
          where: { id: existing.id },
          data: {
            sizeBytes: pdfBuffer.length,
            uploadedAt: new Date(),
            uploadedByUserId: generatedByUserId,
          },
        });
      } else {
        await this.prisma.assetDocument.create({
          data: {
            assetId: inspection.assetId,
            inspectionId: inspection.id,
            clientId: inspection.asset.clientId,
            originalName: filename,
            storagePath: r2Key,
            mimeType: 'application/pdf',
            sizeBytes: pdfBuffer.length,
            uploadedByUserId: generatedByUserId,
          },
        });
      }
    }

    return { stream: Readable.from(pdfBuffer), filename };
  }
}
