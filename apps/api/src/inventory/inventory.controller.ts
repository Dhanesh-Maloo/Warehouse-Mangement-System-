import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { InventoryService } from './inventory.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';
import { toCsv } from '../common/csv/to-csv';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get()
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  findAll(
    @Query('clientId') clientId?: string,
    @Query('locationId') locationId?: string,
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<InventoryService['findAll']> {
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor' || user?.role === 'client_admin'
        ? (user.clientId ?? undefined)
        : clientId;

    return this.inventoryService.findAll({
      clientId: effectiveClientId,
      locationId,
      status,
      skip: skip ? parseInt(skip, 10) : 0,
      take: take ? Math.min(parseInt(take, 10), 200) : 50,
    });
  }

  @Get('summary')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  summary(
    @Query('clientId') clientId?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<InventoryService['summary']> {
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor' || user?.role === 'client_admin'
        ? (user.clientId ?? undefined)
        : clientId;
    return this.inventoryService.summary(effectiveClientId);
  }

  @Get('ageing')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  ageing(
    @Query('clientId') clientId?: string,
    @Query('category') category?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<InventoryService['ageing']> {
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor' || user?.role === 'client_admin'
        ? (user.clientId ?? undefined)
        : clientId;
    return this.inventoryService.ageing({ clientId: effectiveClientId, category });
  }

  /** US-INV-05 — CSV export of the idle-stock ageing view (US-INV-04), full dataset in scope. */
  @Get('ageing/export')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  async exportAgeingCsv(
    @Query('clientId') clientId: string | undefined,
    @Query('category') category: string | undefined,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ): Promise<void> {
    const effectiveClientId =
      user.role === 'client_user' || user.role === 'editor' || user.role === 'client_admin'
        ? (user.clientId ?? undefined)
        : clientId;

    const { rows } = await this.inventoryService.ageing({
      clientId: effectiveClientId,
      category,
    });

    const csv = toCsv(
      [
        'serialNumber',
        'assetTag',
        'model',
        'manufacturer',
        'category',
        'clientId',
        'clientName',
        'daysIdle',
        'bucket',
        'idleSince',
      ],
      rows.map((r) => [
        r.serialNumber,
        r.assetTag,
        r.model,
        r.manufacturer,
        r.category,
        r.clientId,
        r.clientName,
        r.daysIdle,
        r.bucket,
        r.idleSince,
      ]),
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="inventory-ageing-export.csv"');
    res.send(csv);
  }
}
