import { Controller, Get, Post, Patch, Param, Body, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { InboundService } from './inbound.service';
import { CreateExpectedDeliveryDto } from './dto/create-expected-delivery.dto';
import { ReceiveDevicesDto } from './dto/receive-devices.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inbound')
export class InboundController {
  constructor(private readonly inboundService: InboundService) {}

  @Get('deliveries')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor')
  findAllDeliveries(
    @Query('clientId') clientId?: string,
    @Query('expectedDate') expectedDate?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<InboundService['findAllDeliveries']> {
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor'
        ? (user.clientId ?? undefined)
        : clientId;
    return this.inboundService.findAllDeliveries(effectiveClientId, expectedDate);
  }

  @Get('deliveries/:id')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor')
  findOneDelivery(@Param('id') id: string): ReturnType<InboundService['findOneDelivery']> {
    return this.inboundService.findOneDelivery(id);
  }

  @Post('deliveries')
  @Roles('admin', 'manager', 'editor')
  createExpectedDelivery(
    @Body() dto: CreateExpectedDeliveryDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<InboundService['createExpectedDelivery']> {
    if (user.role === 'editor' && user.clientId) dto.clientId = user.clientId;
    return this.inboundService.createExpectedDelivery(dto, user.sub);
  }

  @Post('receive')
  @Roles('admin', 'manager', 'operator', 'editor')
  receiveDevices(
    @Body() dto: ReceiveDevicesDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<InboundService['receiveDevices']> {
    return this.inboundService.receiveDevices(dto, user.sub);
  }

  @Patch('deliveries/:id/status')
  @Roles('admin', 'manager', 'editor')
  updateDeliveryStatus(
    @Param('id') id: string,
    @Body('status') status: 'pending' | 'partially_received' | 'completed' | 'cancelled',
    @CurrentUser() user: JwtPayload,
  ): ReturnType<InboundService['updateDeliveryStatus']> {
    return this.inboundService.updateDeliveryStatus(id, status, user.sub);
  }

  @Get('grns')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor')
  findAllGrns(
    @Query('clientId') clientId?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<InboundService['findAllGrns']> {
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor'
        ? (user.clientId ?? undefined)
        : clientId;
    return this.inboundService.findAllGrns(effectiveClientId);
  }

  @Get('grns/:id/pdf')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor')
  async downloadGrnPdf(@Param('id') id: string, @Res() res: Response): Promise<void> {
    const { stream, filename } = await this.inboundService.generateGrnPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    stream.pipe(res);
  }
}
