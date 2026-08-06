import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { RepairService } from './repair.service';
import { CreateRepairRequestDto } from './dto/create-repair-request.dto';
import { UpdateRepairStatusDto } from './dto/update-repair-status.dto';
import { UpdateRepairSlaDto } from './dto/update-repair-sla.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

@Controller('repair')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RepairController {
  constructor(private readonly repairService: RepairService) {}

  private static isClientScoped(role: string): boolean {
    return role === 'client_user' || role === 'editor' || role === 'client_admin';
  }

  private async assertOwnsRepair(id: string, user: JwtPayload): Promise<void> {
    if (!RepairController.isClientScoped(user.role)) return;
    const repair = await this.repairService.findOne(id);
    if (repair.clientId !== user.clientId) {
      throw new ForbiddenException('Cannot act on a repair request from another client');
    }
  }

  @Get()
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  findAll(
    @Query('clientId') clientId?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<RepairService['findAll']> {
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor' || user?.role === 'client_admin'
        ? (user.clientId ?? undefined)
        : clientId;
    return this.repairService.findAll(effectiveClientId);
  }

  @Get('asset/:assetId')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  findByAsset(
    @Param('assetId') assetId: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<RepairService['findByAsset']> {
    const clientId = RepairController.isClientScoped(user.role)
      ? (user.clientId ?? undefined)
      : undefined;
    return this.repairService.findByAsset(assetId, clientId);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<RepairService['findOne']> {
    await this.assertOwnsRepair(id, user);
    return this.repairService.findOne(id);
  }

  @Post()
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  create(
    @Body() dto: CreateRepairRequestDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<RepairService['create']> {
    // editors/client_admins can only file repair requests for their own client
    if ((user.role === 'editor' || user.role === 'client_admin') && user.clientId) {
      dto.clientId = user.clientId;
    }
    return this.repairService.create(dto, user.sub);
  }

  @Patch(':id/status')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateRepairStatusDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<RepairService['updateStatus']> {
    await this.assertOwnsRepair(id, user);
    return this.repairService.updateStatus(id, dto, user.sub);
  }

  @Patch(':id/sla')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  async updateSla(
    @Param('id') id: string,
    @Body() dto: UpdateRepairSlaDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<RepairService['updateSla']> {
    await this.assertOwnsRepair(id, user);
    return this.repairService.updateSla(id, dto, user.sub);
  }
}
