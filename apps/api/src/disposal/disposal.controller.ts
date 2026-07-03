import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { DisposalService } from './disposal.service';
import { CreateDisposalRequestDto } from './dto/create-disposal-request.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

@Controller('disposal')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DisposalController {
  constructor(private readonly disposalService: DisposalService) {}

  @Get()
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor')
  findAll(
    @Query('clientId') clientId?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<DisposalService['findAll']> {
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor'
        ? (user.clientId ?? undefined)
        : clientId;
    return this.disposalService.findAll(effectiveClientId);
  }

  @Get('asset/:assetId')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor')
  findByAsset(@Param('assetId') assetId: string): ReturnType<DisposalService['findByAsset']> {
    return this.disposalService.findByAsset(assetId);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor')
  findOne(@Param('id') id: string): ReturnType<DisposalService['findOne']> {
    return this.disposalService.findOne(id);
  }

  @Post()
  @Roles('admin', 'manager', 'operator', 'editor')
  create(
    @Body() dto: CreateDisposalRequestDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DisposalService['create']> {
    return this.disposalService.create(dto, user.sub);
  }

  // Approval is an authority gate, not a plain edit — editors are excluded.
  @Patch(':id/approve')
  @Roles('admin', 'manager')
  approve(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DisposalService['approve']> {
    return this.disposalService.approve(id, user.sub);
  }

  @Patch(':id/start-processing')
  @Roles('admin', 'manager', 'operator', 'editor')
  startProcessing(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DisposalService['startProcessing']> {
    return this.disposalService.startProcessing(id, user.sub);
  }

  @Patch(':id/complete')
  @Roles('admin', 'manager', 'operator', 'editor')
  complete(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DisposalService['complete']> {
    return this.disposalService.complete(id, user.sub);
  }
}
