import { Controller, Get, Post, Body, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import type { EventLedger } from '@prisma/client';
import { LedgerService } from './ledger.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { IsOptional, IsUUID, IsDateString, IsInt, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import type { JwtPayload } from '../common/types/jwt-payload.type';

class LedgerCorrectionDto {
  @IsUUID()
  originalEventId!: string;

  @IsString()
  reason!: string;
}

class LedgerQueryDto {
  @IsOptional()
  @IsUUID()
  clientId?: string;

  @IsOptional()
  @IsUUID()
  assetId?: string;

  @IsOptional()
  @IsString()
  eventType?: string;

  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @IsOptional()
  @IsDateString()
  toDate?: string;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  skip?: number;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  take?: number;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ledger')
export class LedgerController {
  constructor(private readonly ledgerService: LedgerService) {}

  @Get()
  @Roles('admin', 'manager', 'client_user', 'editor', 'client_admin')
  async findMany(
    @Query() query: LedgerQueryDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<
    (EventLedger & {
      asset: { id: string; serialNumber: string; assetTag: string | null; model: string };
    })[]
  > {
    const effectiveClientId =
      user.role === 'client_user' || user.role === 'editor' || user.role === 'client_admin'
        ? (user.clientId ?? undefined)
        : query.clientId;

    // When toDate is a date-only string (YYYY-MM-DD), new Date() parses it as
    // midnight UTC — that's 5:30am IST, so events later that day get cut off.
    // Fix: advance to start of the next day and use lt (exclusive upper bound).
    const toDateFilter = query.toDate
      ? (() => {
          const d = new Date(query.toDate);
          if (!query.toDate.includes('T')) d.setDate(d.getDate() + 1);
          return d;
        })()
      : null;

    // A suppressed event was replaced by a bundle charge (e.g. Full Prep
    // suppressing its component INGEST/INSPECT events) — exclude it so the
    // ledger and any total derived from it don't double-count.
    const suppressedIds = await this.ledgerService.findSuppressedEventIds();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.ledgerService.findMany({
      where: {
        ...(effectiveClientId ? { clientId: effectiveClientId } : {}),
        ...(query.assetId ? { assetId: query.assetId } : {}),
        ...(query.eventType ? { eventType: query.eventType } : {}),
        ...(suppressedIds.size > 0 ? { id: { notIn: [...suppressedIds] } } : {}),
        ...(query.fromDate || toDateFilter
          ? {
              occurredAt: {
                ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
                ...(toDateFilter ? { lt: toDateFilter } : {}),
              },
            }
          : {}),
      },
      include: {
        asset: { select: { id: true, serialNumber: true, assetTag: true, model: true } },
      },
      orderBy: { occurredAt: 'desc' },
      skip: query.skip ?? 0,
      take: Math.min(query.take ?? 100, 500),
    } as Parameters<typeof this.ledgerService.findMany>[0]) as never;
  }

  @Get('export')
  @Roles('admin', 'manager')
  async exportCsv(@Query() query: LedgerQueryDto, @Res() res: Response): Promise<void> {
    const toDateFilter = query.toDate
      ? (() => {
          const d = new Date(query.toDate);
          if (!query.toDate.includes('T')) d.setDate(d.getDate() + 1);
          return d;
        })()
      : null;

    const suppressedIds = await this.ledgerService.findSuppressedEventIds();

    const entries = await this.ledgerService.findMany({
      where: {
        ...(query.clientId ? { clientId: query.clientId } : {}),
        ...(query.assetId ? { assetId: query.assetId } : {}),
        ...(query.eventType ? { eventType: query.eventType } : {}),
        ...(suppressedIds.size > 0 ? { id: { notIn: [...suppressedIds] } } : {}),
        ...(query.fromDate || toDateFilter
          ? {
              occurredAt: {
                ...(query.fromDate ? { gte: new Date(query.fromDate) } : {}),
                ...(toDateFilter ? { lt: toDateFilter } : {}),
              },
            }
          : {}),
      },
      orderBy: { occurredAt: 'asc' },
    });

    const header =
      'id,eventType,assetId,clientId,quantity,unitRatePaise,amountPaise,occurredAt,createdBy,referenceId,referenceType\n';
    const rows = entries
      .map((e) =>
        [
          e.id,
          e.eventType,
          e.assetId,
          e.clientId,
          e.quantity,
          e.unitRatePaise.toString(),
          e.amountPaise.toString(),
          e.occurredAt.toISOString(),
          e.createdBy,
          e.referenceId ?? '',
          e.referenceType ?? '',
        ].join(','),
      )
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="ledger-export.csv"');
    res.send(header + rows);
  }

  // Correction creates a reversal row — never mutates original
  @Post('correction')
  @Roles('admin')
  async createCorrection(
    @Body() dto: LedgerCorrectionDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<EventLedger> {
    return this.ledgerService.createCorrection(dto.originalEventId, dto.reason, user.sub);
  }
}
