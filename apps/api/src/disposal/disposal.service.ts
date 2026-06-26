import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LedgerService } from '../ledger/ledger.service';
import { RateCardService } from '../rate-card/rate-card.service';
import { AuditService } from '../audit/audit.service';
import type { CreateDisposalRequestDto } from './dto/create-disposal-request.dto';

@Injectable()
export class DisposalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
    private readonly rateCard: RateCardService,
    private readonly audit: AuditService,
  ) {}

  findAll(
    clientId?: string,
  ): Prisma.PrismaPromise<Prisma.DisposalRequestGetPayload<{ include: { asset: true } }>[]> {
    return this.prisma.disposalRequest.findMany({
      where: clientId ? { clientId } : {},
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
  ): Prisma.PrismaPromise<Prisma.DisposalRequestGetPayload<{ include: { asset: true } }>[]> {
    return this.prisma.disposalRequest.findMany({
      where: { assetId },
      include: { asset: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
