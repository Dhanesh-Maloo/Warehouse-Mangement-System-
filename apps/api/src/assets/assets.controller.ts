import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import type { Response } from 'express';
import { AssetsService } from './assets.service';
import { toCsv } from '../common/csv/to-csv';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetStatusDto } from './dto/update-asset-status.dto';
import { BulkMoveAssetsDto } from './dto/bulk-move-assets.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';
import type { AssetCategory, AssetStatus, AssetCondition, ConditionGrade } from '@prisma/client';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  private static isClientScoped(role: string): boolean {
    return role === 'client_user' || role === 'editor' || role === 'client_admin';
  }

  private async assertOwnsAsset(id: string, user: JwtPayload): Promise<void> {
    if (!AssetsController.isClientScoped(user.role)) return;
    const asset = await this.assetsService.findOne(id);
    if (asset.clientId !== user.clientId) {
      throw new ForbiddenException('Cannot act on an asset from another client');
    }
  }

  @Post()
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  create(
    @Body() dto: CreateAssetDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<AssetsService['create']> {
    // editors/client_admins can only create assets for their own client
    const clientId =
      user.role === 'editor' || user.role === 'client_admin'
        ? (user.clientId ?? dto.clientId)
        : dto.clientId;
    return this.assetsService.create({
      serialNumber: dto.serialNumber,
      assetTag: dto.assetTag,
      referenceName: dto.referenceName,
      vendorName: dto.vendorName,
      model: dto.model,
      manufacturer: dto.manufacturer,
      category: dto.category as AssetCategory,
      clientId,
      currentLocationId: dto.currentLocationId,
      conditionGrade: dto.conditionGrade as ConditionGrade | undefined,
      assetCondition: dto.assetCondition as AssetCondition | undefined,
      currentStatus: (dto.currentStatus ?? 'in_storage') as AssetStatus,
      repairHandling: dto.repairHandling,
      repairServiceName: dto.repairServiceName,
      repairEstimateCost: dto.repairEstimateCost,
      awbNumber: dto.awbNumber,
      courierName: dto.courierName,
      deliveredAt: dto.deliveredAt,
      disposalType: dto.disposalType,
      hasCertification: dto.hasCertification,
    });
  }

  @Get()
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  findAll(
    @Query('clientId') clientId?: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('assetCondition') assetCondition?: string,
    @Query('search') search?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<AssetsService['findAll']> {
    // client_users and editors can only see their own client's assets
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor' || user?.role === 'client_admin'
        ? (user.clientId ?? undefined)
        : clientId;

    return this.assetsService.findAll({
      clientId: effectiveClientId,
      category: category as never,
      currentStatus: status as never,
      assetCondition: assetCondition as never,
      search,
      skip: skip ? parseInt(skip, 10) : 0,
      take: take ? Math.min(parseInt(take, 10), 200) : 50,
    });
  }

  /**
   * US-INV-05 — CSV export of the asset register. Always the full dataset
   * the caller's role/tenant can see (filters are applied, but pagination
   * is not), per the product decision to export everything in scope rather
   * than only the current page.
   */
  @Get('export')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  async exportCsv(
    @Query('clientId') clientId: string | undefined,
    @Query('category') category: string | undefined,
    @Query('status') status: string | undefined,
    @Query('assetCondition') assetCondition: string | undefined,
    @Query('search') search: string | undefined,
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ): Promise<void> {
    const effectiveClientId =
      user.role === 'client_user' || user.role === 'editor' || user.role === 'client_admin'
        ? (user.clientId ?? undefined)
        : clientId;

    const assets = await this.assetsService.findAllForExport({
      clientId: effectiveClientId,
      category: category as never,
      currentStatus: status as never,
      assetCondition: assetCondition as never,
      search,
    });

    const csv = toCsv(
      [
        'serialNumber',
        'assetTag',
        'referenceName',
        'vendorName',
        'model',
        'manufacturer',
        'category',
        'clientId',
        'currentStatus',
        'assetCondition',
        'conditionGrade',
        'currentLocation',
        'awbNumber',
        'courierName',
        'deliveredAt',
        'disposalType',
        'hasCertification',
        'createdAt',
        'updatedAt',
      ],
      assets.map((a) => [
        a.serialNumber,
        a.assetTag,
        a.referenceName,
        a.vendorName,
        a.model,
        a.manufacturer,
        a.category,
        a.clientId,
        a.currentStatus,
        a.assetCondition,
        a.conditionGrade,
        a.currentLocation?.name ?? '',
        a.awbNumber,
        a.courierName,
        a.deliveredAt,
        a.disposalType,
        a.hasCertification,
        a.createdAt,
        a.updatedAt,
      ]),
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="asset-register-export.csv"');
    res.send(csv);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<AssetsService['findOne']> {
    await this.assertOwnsAsset(id, user);
    return this.assetsService.findOne(id);
  }

  /**
   * GET /assets/:id/billing-summary?month=YYYY-MM
   * Every ledger charge against this asset in the given month, plus days
   * spent in_storage that month. Defaults to the current month if omitted.
   */
  @Get(':id/billing-summary')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  async billingSummary(
    @Param('id') id: string,
    @Query('month') month: string | undefined,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<AssetsService['getBillingSummary']> {
    await this.assertOwnsAsset(id, user);
    const now = new Date();
    const effectiveMonth =
      month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return this.assetsService.getBillingSummary(id, effectiveMonth);
  }

  @Patch(':id')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAssetStatusDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<AssetsService['updateStatus']> {
    await this.assertOwnsAsset(id, user);
    return this.assetsService.updateStatus(id, dto);
  }

  @Patch(':id/move')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  async move(
    @Param('id') id: string,
    @Body('locationId') locationId: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<AssetsService['moveLocation']> {
    await this.assertOwnsAsset(id, user);
    return this.assetsService.moveLocation(id, locationId);
  }

  @Post('bulk-move')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  async bulkMove(
    @Body() dto: BulkMoveAssetsDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<AssetsService['bulkMoveLocation']> {
    await Promise.all(dto.assetIds.map((id) => this.assertOwnsAsset(id, user)));
    return this.assetsService.bulkMoveLocation(dto.assetIds, dto.locationId);
  }
}
