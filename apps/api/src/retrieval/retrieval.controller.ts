import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
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

  @Get()
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor')
  findAll(
    @Query('clientId') clientId?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<RetrievalService['findAll']> {
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor'
        ? (user.clientId ?? undefined)
        : clientId;
    return this.retrievalService.findAll(effectiveClientId);
  }

  @Get('asset/:assetId')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor')
  findByAsset(@Param('assetId') assetId: string): ReturnType<RetrievalService['findByAsset']> {
    return this.retrievalService.findByAsset(assetId);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor')
  findOne(@Param('id') id: string): ReturnType<RetrievalService['findOne']> {
    return this.retrievalService.findOne(id);
  }

  @Post()
  @Roles('admin', 'manager', 'operator', 'editor')
  create(
    @Body() dto: CreateRetrievalRequestDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<RetrievalService['create']> {
    return this.retrievalService.create(dto, user.sub);
  }

  @Patch(':id/status')
  @Roles('admin', 'manager', 'operator', 'editor')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateRetrievalStatusDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<RetrievalService['updateStatus']> {
    return this.retrievalService.updateStatus(id, dto, user.sub);
  }
}
