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
import { RetrievalService } from './retrieval.service';
import { CreateRetrievalRequestDto } from './dto/create-retrieval-request.dto';
import { UpdateRetrievalStatusDto } from './dto/update-retrieval-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('retrieval')
export class RetrievalController {
  constructor(private readonly retrievalService: RetrievalService) {}

  private static isClientScoped(role: string): boolean {
    return role === 'client_user' || role === 'editor' || role === 'client_admin';
  }

  private async assertOwnsRetrieval(id: string, user: JwtPayload): Promise<void> {
    if (!RetrievalController.isClientScoped(user.role)) return;
    const retrieval = await this.retrievalService.findOne(id);
    if (retrieval.clientId !== user.clientId) {
      throw new ForbiddenException('Cannot act on a retrieval request from another client');
    }
  }

  @Get()
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  findAll(
    @Query('clientId') clientId?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<RetrievalService['findAll']> {
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor' || user?.role === 'client_admin'
        ? (user.clientId ?? undefined)
        : clientId;
    return this.retrievalService.findAll(effectiveClientId);
  }

  @Get('asset/:assetId')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  findByAsset(
    @Param('assetId') assetId: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<RetrievalService['findByAsset']> {
    const clientId = RetrievalController.isClientScoped(user.role)
      ? (user.clientId ?? undefined)
      : undefined;
    return this.retrievalService.findByAsset(assetId, clientId);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<RetrievalService['findOne']> {
    await this.assertOwnsRetrieval(id, user);
    return this.retrievalService.findOne(id);
  }

  @Post()
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  create(
    @Body() dto: CreateRetrievalRequestDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<RetrievalService['create']> {
    return this.retrievalService.create(dto, user.sub);
  }

  @Patch(':id/status')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateRetrievalStatusDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<RetrievalService['updateStatus']> {
    await this.assertOwnsRetrieval(id, user);
    return this.retrievalService.updateStatus(id, dto, user.sub);
  }

  @Patch(':id/zone')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  async updateZone(
    @Param('id') id: string,
    @Body('courierZone') courierZone: 'intra_state' | 'inter_state' | 'rural',
    @CurrentUser() user: JwtPayload,
  ): ReturnType<RetrievalService['updateZone']> {
    await this.assertOwnsRetrieval(id, user);
    return this.retrievalService.updateZone(id, courierZone, user.sub);
  }
}
