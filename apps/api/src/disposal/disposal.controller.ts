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
import { DisposalService } from './disposal.service';
import { CreateDisposalRequestDto } from './dto/create-disposal-request.dto';
import { UpdateTicketsDto } from '../common/dto/update-tickets.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

@Controller('disposal')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DisposalController {
  constructor(private readonly disposalService: DisposalService) {}

  private static isClientScoped(role: string): boolean {
    return role === 'client_user' || role === 'editor' || role === 'client_admin';
  }

  private async assertOwnsDisposal(id: string, user: JwtPayload): Promise<void> {
    if (!DisposalController.isClientScoped(user.role)) return;
    const disposal = await this.disposalService.findOne(id);
    if (disposal.clientId !== user.clientId) {
      throw new ForbiddenException('Cannot act on a disposal request from another client');
    }
  }

  @Get()
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  findAll(
    @Query('clientId') clientId?: string,
    @Query('status') status?: string,
    @Query('disposalType') disposalType?: string,
    @Query('search') search?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<DisposalService['findAll']> {
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor' || user?.role === 'client_admin'
        ? (user.clientId ?? undefined)
        : clientId;
    return this.disposalService.findAll(effectiveClientId, {
      status,
      disposalType,
      search,
      fromDate,
      toDate,
    });
  }

  @Get('asset/:assetId')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  findByAsset(
    @Param('assetId') assetId: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DisposalService['findByAsset']> {
    const clientId = DisposalController.isClientScoped(user.role)
      ? (user.clientId ?? undefined)
      : undefined;
    return this.disposalService.findByAsset(assetId, clientId);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DisposalService['findOne']> {
    await this.assertOwnsDisposal(id, user);
    return this.disposalService.findOne(id);
  }

  @Post()
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  create(
    @Body() dto: CreateDisposalRequestDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DisposalService['create']> {
    // editors/client_admins can only file disposal requests for their own client
    if ((user.role === 'editor' || user.role === 'client_admin') && user.clientId) {
      dto.clientId = user.clientId;
    }
    return this.disposalService.create(dto, user.sub);
  }

  // Approval is an authority gate — editors are excluded; client_admin may approve within their own client.
  @Patch(':id/approve')
  @Roles('admin', 'manager', 'client_admin')
  async approve(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DisposalService['approve']> {
    await this.assertOwnsDisposal(id, user);
    return this.disposalService.approve(id, user.sub);
  }

  @Patch(':id/start-processing')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  async startProcessing(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DisposalService['startProcessing']> {
    await this.assertOwnsDisposal(id, user);
    return this.disposalService.startProcessing(id, user.sub);
  }

  @Patch(':id/complete')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  async complete(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DisposalService['complete']> {
    await this.assertOwnsDisposal(id, user);
    return this.disposalService.complete(id, user.sub);
  }

  @Patch(':id/tickets')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  async updateTickets(
    @Param('id') id: string,
    @Body() dto: UpdateTicketsDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DisposalService['updateTickets']> {
    await this.assertOwnsDisposal(id, user);
    return this.disposalService.updateTickets(id, dto);
  }

  @Get(':id/certificate')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  async downloadCertificate(
    @Param('id') id: string,
    @Res() res: Response,
    @CurrentUser() user: JwtPayload,
  ): Promise<void> {
    const requestingClientId = DisposalController.isClientScoped(user.role)
      ? (user.clientId ?? undefined)
      : undefined;
    const { stream, filename } = await this.disposalService.generateDisposalCertificatePdf(
      id,
      requestingClientId,
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    stream.pipe(res);
  }
}
