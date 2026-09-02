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
import { AssetStatusHistoryService } from '../asset-status-history/asset-status-history.service';
import { UsersService } from '../users/users.service';
import { MailService } from '../mail/mail.service';
import { disposalApprovalNeededEmail } from '../mail/templates/disposal-approval-needed';
import type { CreateDisposalRequestDto } from './dto/create-disposal-request.dto';
// eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
const PDFDocument = require('pdfkit') as typeof import('pdfkit');

const DISPOSAL_TYPE_LABELS: Record<string, string> = {
  non_certified: 'Non-Certified Disposal',
  certified_blanco: 'Certified Data Destruction',
  itad_bundled: 'ITAD Bundled Disposal',
};

// Roles that approve disposals (SPEC.md: "manager ... Approves disposals").
// Admins are included too, per Dhanesh (2026-09-01) — they have full access
// and should also see approval-needed notifications.
const DISPOSAL_APPROVER_ROLES = ['manager', 'admin'];

// Per Dhanesh (2026-09-02): always CC on disposal approval-needed emails.
const DISPOSAL_APPROVAL_CC = ['dewang@ivalueindia.com'];

@Injectable()
export class DisposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rateCard: RateCardService,
    private readonly audit: AuditService,
    private readonly assetStatusHistory: AssetStatusHistoryService,
    private readonly users: UsersService,
    private readonly mail: MailService,
  ) {}

  findAll(
    clientId?: string,
    filters?: {
      status?: string;
      disposalType?: string;
      search?: string;
      fromDate?: string;
      toDate?: string;
    },
  ): Prisma.PrismaPromise<Prisma.DisposalRequestGetPayload<{ include: { asset: true } }>[]> {
    const toDateFilter = filters?.toDate
      ? (() => {
          const d = new Date(filters.toDate as string);
          if (!(filters.toDate as string).includes('T')) d.setDate(d.getDate() + 1);
          return d;
        })()
      : null;

    const searchFilter = filters?.search
      ? {
          OR: [
            { ivalueTicketNumber: { contains: filters.search, mode: 'insensitive' as const } },
            { clientTicketNumber: { contains: filters.search, mode: 'insensitive' as const } },
            {
              asset: {
                OR: [
                  { serialNumber: { contains: filters.search, mode: 'insensitive' as const } },
                  { model: { contains: filters.search, mode: 'insensitive' as const } },
                  { manufacturer: { contains: filters.search, mode: 'insensitive' as const } },
                  { assetTag: { contains: filters.search, mode: 'insensitive' as const } },
                ],
              },
            },
          ],
        }
      : {};

    return this.prisma.disposalRequest.findMany({
      where: {
        ...(clientId ? { clientId } : {}),
        ...(filters?.status ? { status: filters.status as never } : {}),
        ...(filters?.disposalType ? { disposalType: filters.disposalType as never } : {}),
        ...(filters?.fromDate || toDateFilter
          ? {
              createdAt: {
                ...(filters?.fromDate ? { gte: new Date(filters.fromDate) } : {}),
                ...(toDateFilter ? { lt: toDateFilter } : {}),
              },
            }
          : {}),
        ...searchFilter,
      },
      include: { asset: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(
    id: string,
  ): Promise<Prisma.DisposalRequestGetPayload<{ include: { asset: true } }>> {
    const disposal = await this.prisma.disposalRequest.findUnique({
      where: { id },
      include: { asset: true },
    });
    if (!disposal) throw new NotFoundException(`Disposal request ${id} not found`);
    return disposal;
  }

  async create(
    dto: CreateDisposalRequestDto,
    createdByUserId: string,
  ): Promise<Prisma.DisposalRequestGetPayload<{ include: { asset: true } }>> {
    const asset = await this.prisma.asset.findUnique({ where: { id: dto.assetId } });
    if (!asset) throw new NotFoundException(`Asset ${dto.assetId} not found`);

    if (asset.clientId !== dto.clientId) {
      throw new BadRequestException(
        `Asset ${dto.assetId} does not belong to client ${dto.clientId}`,
      );
    }

    if (asset.currentStatus !== 'in_storage') {
      throw new BadRequestException(
        `Asset ${dto.assetId} must be in_storage to request disposal (current status: ${asset.currentStatus})`,
      );
    }

    const disposal = await this.prisma.disposalRequest.create({
      data: {
        clientId: dto.clientId,
        assetId: dto.assetId,
        disposalType: dto.disposalType,
        // certified_blanco already includes certification — never double-bill it.
        requiresCertification:
          dto.disposalType === 'certified_blanco' ? false : (dto.requiresCertification ?? false),
        ivalueTicketNumber: dto.ivalueTicketNumber,
        clientTicketNumber: dto.clientTicketNumber,
        notes: dto.notes,
        status: 'pending',
        createdByUserId,
      },
      include: { asset: true },
    });

    await this.audit.log({
      userId: createdByUserId,
      action: 'disposal.create',
      entity: 'DisposalRequest',
      entityId: disposal.id,
      newValue: { assetId: dto.assetId, disposalType: dto.disposalType, status: 'pending' },
    });

    const approverEmails = await this.users.findEmailsByRoles(DISPOSAL_APPROVER_ROLES);
    if (approverEmails.length > 0) {
      const { subject, html, text } = disposalApprovalNeededEmail({
        assetLabel: `${asset.manufacturer} ${asset.model} (${asset.serialNumber})`,
        disposalType: dto.disposalType,
        ivalueTicketNumber: dto.ivalueTicketNumber,
      });
      void this.mail.send({ to: approverEmails, subject, html, text, cc: DISPOSAL_APPROVAL_CC });
    }

    return disposal;
  }

  async approve(
    id: string,
    approvedByUserId: string,
  ): Promise<Prisma.DisposalRequestGetPayload<{ include: { asset: true } }>> {
    const disposal = await this.findOne(id);

    if (disposal.status !== 'pending') {
      throw new BadRequestException(
        `Disposal request ${id} cannot be approved from status '${disposal.status}'`,
      );
    }

    const occurredAt = new Date();

    // Map disposal type to rate card code
    const rateCodeMap: Record<string, string> = {
      non_certified: 'DISPOSAL_NON_CERT',
      certified_blanco: 'DISPOSAL_CERTIFIED',
      itad_bundled: 'DISPOSAL_ITAD',
    };
    const rateCode = rateCodeMap[disposal.disposalType];
    const rate = await this.rateCard.findEffectiveAt(rateCode, occurredAt);
    const unitRate = rate ? rate.unitRatePaise : BigInt(0);

    // ₹550 + GST certification add-on (confirmed by Divya) — billed as its
    // own line item so the ledger clearly separates it from the base
    // disposal fee. certified_blanco already includes certification, so
    // requiresCertification is always false for that type (enforced at
    // create time) and this never double-bills it.
    let certUnitRate: bigint | null = null;
    if (disposal.requiresCertification) {
      const certRate = await this.rateCard.findEffectiveAt('DISPOSAL_CERT_ADDON', occurredAt);
      certUnitRate = certRate ? certRate.unitRatePaise : BigInt(0);
    }

    const updated = await this.prisma.disposalRequest.update({
      where: { id },
      data: {
        status: 'approved',
        approvedAt: occurredAt,
        approvedByUserId,
      },
      include: { asset: true },
    });

    await this.ledger.create({
      eventType: rateCode,
      asset: { connect: { id: disposal.assetId } },
      client: { connect: { id: disposal.clientId } },
      quantity: 1,
      unitRatePaise: unitRate,
      amountPaise: unitRate,
      occurredAt,
      createdBy: approvedByUserId,
      referenceId: id,
      referenceType: 'disposal',
    });

    if (certUnitRate !== null) {
      await this.ledger.create({
        eventType: 'DISPOSAL_CERT_ADDON',
        asset: { connect: { id: disposal.assetId } },
        client: { connect: { id: disposal.clientId } },
        quantity: 1,
        unitRatePaise: certUnitRate,
        amountPaise: certUnitRate,
        occurredAt,
        createdBy: approvedByUserId,
        referenceId: id,
        referenceType: 'disposal',
      });
    }

    await this.audit.log({
      userId: approvedByUserId,
      action: 'disposal.approve',
      entity: 'DisposalRequest',
      entityId: id,
      oldValue: { status: 'pending' },
      newValue: { status: 'approved' },
    });

    return updated;
  }

  async startProcessing(
    id: string,
    userId: string,
  ): Promise<Prisma.DisposalRequestGetPayload<{ include: { asset: true } }>> {
    const disposal = await this.findOne(id);
    if (disposal.status !== 'approved') {
      throw new BadRequestException(
        `Disposal request ${id} cannot be started from status '${disposal.status}'`,
      );
    }
    const updated = await this.prisma.disposalRequest.update({
      where: { id },
      data: { status: 'in_progress', initiatedAt: new Date() },
      include: { asset: true },
    });

    await this.audit.log({
      userId,
      action: 'disposal.startProcessing',
      entity: 'DisposalRequest',
      entityId: id,
      oldValue: { status: 'approved' },
      newValue: { status: 'in_progress' },
    });

    return updated;
  }

  async complete(
    id: string,
    userId: string,
  ): Promise<Prisma.DisposalRequestGetPayload<{ include: { asset: true } }>> {
    const disposal = await this.findOne(id);

    if (disposal.status !== 'in_progress') {
      throw new BadRequestException(
        `Disposal request ${id} cannot be completed from status '${disposal.status}'`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.disposalRequest.update({
        where: { id },
        data: { status: 'completed', completedAt: new Date() },
        include: { asset: true },
      });
      await tx.asset.update({
        where: { id: disposal.assetId },
        data: { currentStatus: 'disposed' },
      });
      await this.assetStatusHistory.record(
        {
          assetId: disposal.assetId,
          clientId: disposal.clientId,
          fromStatus: disposal.asset.currentStatus,
          toStatus: 'disposed',
          sourceModule: 'disposal',
        },
        tx,
      );
      return result;
    });

    await this.audit.log({
      userId,
      action: 'disposal.complete',
      entity: 'DisposalRequest',
      entityId: id,
      oldValue: { status: 'in_progress' },
      newValue: { status: 'completed' },
    });

    return updated;
  }

  findByAsset(
    assetId: string,
    clientId?: string,
  ): Prisma.PrismaPromise<Prisma.DisposalRequestGetPayload<{ include: { asset: true } }>[]> {
    return this.prisma.disposalRequest.findMany({
      where: clientId ? { assetId, clientId } : { assetId },
      include: { asset: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateTickets(
    id: string,
    dto: { ivalueTicketNumber?: string; clientTicketNumber?: string },
  ): Promise<Prisma.DisposalRequestGetPayload<{ include: { asset: true } }>> {
    await this.findOne(id);
    return this.prisma.disposalRequest.update({
      where: { id },
      data: {
        ivalueTicketNumber: dto.ivalueTicketNumber,
        clientTicketNumber: dto.clientTicketNumber,
      },
      include: { asset: true },
    });
  }

  /**
   * Certificate of Disposal — proves an asset was disposed of, for handoff
   * to the client. Available once the request is 'completed'. Mirrors
   * Retrieval's confirmation PDF / Inbound's GRN.
   */
  async generateDisposalCertificatePdf(
    id: string,
    requestingClientId?: string,
  ): Promise<{ stream: NodeJS.ReadableStream; filename: string }> {
    const disposal = await this.prisma.disposalRequest.findUnique({
      where: { id },
      include: {
        client: true,
        asset: {
          select: {
            serialNumber: true,
            assetTag: true,
            model: true,
            category: true,
            manufacturer: true,
          },
        },
        createdBy: { select: { fullName: true } },
        approvedBy: { select: { fullName: true } },
      },
    });
    if (!disposal) throw new NotFoundException(`Disposal request ${id} not found`);
    if (requestingClientId && disposal.clientId !== requestingClientId) {
      throw new ForbiddenException('Cannot download a disposal certificate from another client');
    }
    if (disposal.status !== 'completed') {
      throw new BadRequestException(
        'Disposal certificate is only available once the request has been completed',
      );
    }

    const displayNumber = `DISP-${disposal.id.slice(-8).toUpperCase()}`;
    const doc = new PDFDocument({ margin: 50, size: 'A4' });

    // Header
    doc.fontSize(20).font('Helvetica-Bold').text('IValue WMS', 50, 50);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#666666')
      .text('Warehouse Management System', 50, 74);
    doc
      .fillColor('#000000')
      .fontSize(18)
      .font('Helvetica-Bold')
      .text('Certificate of Disposal', 50, 100);

    // Metadata box
    doc.rect(50, 130, 495, 80).stroke('#cccccc');
    doc.fontSize(9).font('Helvetica-Bold').text('Certificate Number', 60, 140);
    doc.font('Helvetica').fontSize(12).text(displayNumber, 60, 153);
    doc.fontSize(9).font('Helvetica-Bold').text('Client', 220, 140);
    doc.font('Helvetica').fontSize(11).text(disposal.client.name, 220, 153);
    doc.fontSize(9).font('Helvetica-Bold').text('Completed at', 400, 140);
    doc
      .font('Helvetica')
      .fontSize(10)
      .text(
        (disposal.completedAt ?? disposal.updatedAt).toLocaleString('en-IN', {
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
    doc.fontSize(9).font('Helvetica-Bold').text('Ticket (iValue)', 60, 178);
    doc.font('Helvetica').text(disposal.ivalueTicketNumber ?? '—', 60, 191);
    doc.fontSize(9).font('Helvetica-Bold').text('Ticket (client)', 220, 178);
    doc.font('Helvetica').text(disposal.clientTicketNumber ?? '—', 220, 191);
    doc.fontSize(9).font('Helvetica-Bold').text('Disposal type', 400, 178);
    doc
      .font('Helvetica')
      .text(DISPOSAL_TYPE_LABELS[disposal.disposalType] ?? disposal.disposalType, 400, 191);

    let cursorY = 222;
    doc.fontSize(9).font('Helvetica-Bold').text('Certification:', 50, cursorY);
    doc
      .font('Helvetica')
      .text(
        disposal.requiresCertification || disposal.disposalType === 'certified_blanco'
          ? 'Certified'
          : 'Not certified',
        155,
        cursorY,
      );
    cursorY += 15;
    if (disposal.approvedBy) {
      doc.fontSize(9).font('Helvetica-Bold').text('Approved by:', 50, cursorY);
      doc.font('Helvetica').text(disposal.approvedBy.fullName, 155, cursorY);
      cursorY += 15;
    }

    // Asset details table
    const tableTop = cursorY + 10;
    doc.fontSize(10).font('Helvetica-Bold').text('Disposed asset', 50, tableTop);

    const tableStart = tableTop + 18;
    doc.rect(50, tableStart, 495, 20).fill('#1A2B3C');
    doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
    doc.text('Serial number', 55, tableStart + 6);
    doc.text('Asset tag', 210, tableStart + 6);
    doc.text('Model', 320, tableStart + 6);
    doc.text('Category', 440, tableStart + 6);
    doc.fillColor('#000000');

    const rowY = tableStart + 20;
    doc.rect(50, rowY, 495, 22).fill('#f8f8f8');
    doc.fillColor('#000000').font('Helvetica').fontSize(8);
    doc.text(disposal.asset.serialNumber, 55, rowY + 7, { width: 145 });
    doc.text(disposal.asset.assetTag ?? '—', 210, rowY + 7, { width: 100 });
    doc.text(`${disposal.asset.manufacturer} ${disposal.asset.model}`, 320, rowY + 7, {
      width: 115,
    });
    doc.text(disposal.asset.category, 440, rowY + 7);

    // Footer
    const footerY = Math.max(rowY + 60, 680);
    doc.moveTo(50, footerY).lineTo(545, footerY).stroke('#cccccc');
    doc
      .fontSize(8)
      .fillColor('#888888')
      .text(
        `Generated by IValue WMS · ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST`,
        50,
        footerY + 8,
        { align: 'center', width: 495 },
      );

    doc.end();
    return { stream: doc, filename: `${displayNumber}.pdf` };
  }
}
