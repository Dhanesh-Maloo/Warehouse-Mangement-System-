import { Controller, Get, Post, Patch, Param, Body, Query, UseGuards } from '@nestjs/common';
import { DeploymentService } from './deployment.service';
import { CreateDeploymentOrderDto } from './dto/create-deployment-order.dto';
import { UpdateDeploymentStatusDto } from './dto/update-deployment-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

@Controller('deployment')
@UseGuards(JwtAuthGuard, RolesGuard)
export class DeploymentController {
  constructor(private readonly deploymentService: DeploymentService) {}

  @Get()
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  findAll(
    @Query('clientId') clientId?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<DeploymentService['findAll']> {
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor' || user?.role === 'client_admin'
        ? (user.clientId ?? undefined)
        : clientId;
    return this.deploymentService.findAll(effectiveClientId);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  findOne(@Param('id') id: string): ReturnType<DeploymentService['findOne']> {
    return this.deploymentService.findOne(id);
  }

  @Post()
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  create(
    @Body() dto: CreateDeploymentOrderDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DeploymentService['create']> {
    return this.deploymentService.create(dto, user.sub);
  }

  @Patch(':id/status')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDeploymentStatusDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DeploymentService['updateStatus']> {
    return this.deploymentService.updateStatus(id, dto, user.sub);
  }

  @Patch(':id/zone')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  updateZone(
    @Param('id') id: string,
    @Body('courierZone') courierZone: 'intra_state' | 'inter_state' | 'rural',
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DeploymentService['updateZone']> {
    return this.deploymentService.updateZone(id, courierZone, user.sub);
  }

  @Patch(':id/tracking')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  updateTracking(
    @Param('id') id: string,
    @Body('trackingNumber') trackingNumber: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DeploymentService['updateTracking']> {
    return this.deploymentService.updateTracking(id, trackingNumber, user.sub);
  }
}
