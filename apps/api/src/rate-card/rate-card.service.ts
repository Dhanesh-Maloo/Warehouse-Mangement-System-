import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { RateCardItem } from '@prisma/client';
import type { CreateRateCardItemDto } from './dto/create-rate-card-item.dto';

@Injectable()
export class RateCardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(): Promise<RateCardItem[]> {
    return this.prisma.rateCardItem.findMany({
      orderBy: [{ code: 'asc' }, { effectiveFrom: 'desc' }],
    });
  }

  async findCurrent(): Promise<RateCardItem[]> {
    return this.prisma.rateCardItem.findMany({
      where: { effectiveTo: null },
      orderBy: { code: 'asc' },
    });
  }

  async findOne(id: string): Promise<RateCardItem> {
    const item = await this.prisma.rateCardItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Rate card item ${id} not found`);
    return item;
  }

  // Returns the rate effective at a given point in time for a given code
  async findEffectiveAt(code: string, at: Date): Promise<RateCardItem | null> {
    return this.prisma.rateCardItem.findFirst({
      where: {
        code,
        effectiveFrom: { lte: at },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  async create(dto: CreateRateCardItemDto): Promise<RateCardItem> {
    const effectiveFrom = new Date(dto.effectiveFrom);

    // Close out the previous version of this code (set its effectiveTo)
    const previous = await this.prisma.rateCardItem.findFirst({
      where: { code: dto.code, effectiveTo: null },
    });
    if (previous) {
      await this.prisma.rateCardItem.update({
        where: { id: previous.id },
        data: { effectiveTo: effectiveFrom },
      });
    }

    const item = await this.prisma.rateCardItem.create({
      data: {
        code: dto.code,
        description: dto.description,
        basis: dto.basis,
        categoryApplies: dto.categoryApplies,
        unitRatePaise: BigInt(dto.unitRatePaise),
        effectiveFrom,
        isBundle: dto.isBundle,
        bundleComponentCodes: dto.bundleComponentCodes ?? [],
      },
    });
    await this.audit.log({
      userId: 'system',
      action: 'ratecard.create',
      entity: 'RateCardItem',
      entityId: item.id,
      newValue: {
        code: item.code,
        unitRatePaise: dto.unitRatePaise,
        effectiveFrom: dto.effectiveFrom,
      },
    });
    return item;
  }
}
