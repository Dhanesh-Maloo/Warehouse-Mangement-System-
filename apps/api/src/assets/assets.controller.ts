import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { CreateAssetDto } from './dto/create-asset.dto';
import { UpdateAssetStatusDto } from './dto/update-asset-status.dto';
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

  @Post()
  @Roles('admin', 'manager', 'operator', 'editor')
  create(
    @Body() dto: CreateAssetDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<AssetsService['create']> {
    // editors can only create assets for their own client
    const clientId = user.role === 'editor' ? (user.clientId ?? dto.clientId) : dto.clientId;
    return this.assetsService.create({
      serialNumber: dto.serialNumber,
      assetTag: dto.assetTag,
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
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor')
  findAll(
    @Query('clientId') clientId?: string,
    @Query('category') category?: string,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<AssetsService['findAll']> {
    // client_users and editors can only see their own client's assets
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor'
        ? (user.clientId ?? undefined)
        : clientId;

    return this.assetsService.findAll({
      clientId: effectiveClientId,
      category: category as never,
      currentStatus: status as never,
      search,
      skip: skip ? parseInt(skip, 10) : 0,
      take: take ? Math.min(parseInt(take, 10), 200) : 50,
    });
  }

  @Get(':id')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor')
  findOne(@Param('id') id: string): ReturnType<AssetsService['findOne']> {
    return this.assetsService.findOne(id);
  }

  @Patch(':id')
  @Roles('admin', 'manager', 'operator', 'editor')
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAssetStatusDto,
  ): ReturnType<AssetsService['updateStatus']> {
    return this.assetsService.updateStatus(id, dto);
  }

  @Patch(':id/move')
  @Roles('admin', 'manager', 'operator', 'editor')
  move(
    @Param('id') id: string,
    @Body('locationId') locationId: string,
  ): ReturnType<AssetsService['moveLocation']> {
    return this.assetsService.moveLocation(id, locationId);
  }
}
