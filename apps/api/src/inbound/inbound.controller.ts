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

  private static isClientScoped(role: string): boolean {
    return role === 'client_user' || role === 'editor' || role === 'client_admin';
  }

  private async assertOwnsDelivery(id: string, user: JwtPayload): Promise<void> {
    if (!InboundController.isClientScoped(user.role)) return;
    const delivery = await this.inboundService.findOneDelivery(id);
    if (delivery.clientId !== user.clientId) {
      throw new ForbiddenException('Cannot act on a delivery from another client');
    }
  }

  @Get('deliveries')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  findAllDeliveries(
    @Query('clientId') clientId?: string,
    @Query('expectedDate') expectedDate?: string,
    @Query('search') search?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<InboundService['findAllDeliveries']> {
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor' || user?.role === 'client_admin'
        ? (user.clientId ?? undefined)
        : clientId;
    return this.inboundService.findAllDeliveries(effectiveClientId, expectedDate, search);
  }

  @Get('deliveries/:id')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  async findOneDelivery(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<InboundService['findOneDelivery']> {
    await this.assertOwnsDelivery(id, user);
    return this.inboundService.findOneDelivery(id);
  }

  @Post('deliveries')
  @Roles('admin', 'manager', 'editor', 'client_admin')
  createExpectedDelivery(
    @Body() dto: CreateExpectedDeliveryDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<InboundService['createExpectedDelivery']> {
    if ((user.role === 'editor' || user.role === 'client_admin') && user.clientId)
      dto.clientId = user.clientId;
    return this.inboundService.createExpectedDelivery(dto, user.sub);
  }

  @Post('receive')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  async receiveDevices(
    @Body() dto: ReceiveDevicesDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<InboundService['receiveDevices']> {
    await this.assertOwnsDelivery(dto.expectedDeliveryId, user);
    return this.inboundService.receiveDevices(dto, user.sub);
  }

  @Patch('deliveries/:id/status')
  @Roles('admin', 'manager', 'editor', 'client_admin')
  async updateDeliveryStatus(
    @Param('id') id: string,
    @Body('status') status: 'pending' | 'partially_received' | 'completed' | 'cancelled',
    @CurrentUser() user: JwtPayload,
  ): ReturnType<InboundService['updateDeliveryStatus']> {
    await this.assertOwnsDelivery(id, user);
    return this.inboundService.updateDeliveryStatus(id, status, user.sub);
  }

  @Get('grns')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  findAllGrns(
    @Query('clientId') clientId?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<InboundService['findAllGrns']> {
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor' || user?.role === 'client_admin'
        ? (user.clientId ?? undefined)
        : clientId;
    return this.inboundService.findAllGrns(effectiveClientId);
  }

  @Get('grns/:id/pdf')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  async downloadGrnPdf(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    const requestingClientId = InboundController.isClientScoped(user.role)
      ? (user.clientId ?? undefined)
      : undefined;
    const { stream, filename } = await this.inboundService.generateGrnPdf(id, requestingClientId);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    stream.pipe(res);
  }
}
