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

  private static isClientScoped(role: string): boolean {
    return role === 'client_user' || role === 'editor' || role === 'client_admin';
  }

  private async assertOwnsOrder(id: string, user: JwtPayload): Promise<void> {
    if (!DeploymentController.isClientScoped(user.role)) return;
    const order = await this.deploymentService.findOne(id);
    if (order.clientId !== user.clientId) {
      throw new ForbiddenException('Cannot act on a deployment order from another client');
    }
  }

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
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DeploymentService['findOne']> {
    await this.assertOwnsOrder(id, user);
    return this.deploymentService.findOne(id);
  }

  @Post()
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  create(
    @Body() dto: CreateDeploymentOrderDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DeploymentService['create']> {
    // editors/client_admins can only create deployment orders for their own client
    if ((user.role === 'editor' || user.role === 'client_admin') && user.clientId) {
      dto.clientId = user.clientId;
    }
    return this.deploymentService.create(dto, user.sub);
  }

  @Patch(':id/status')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateDeploymentStatusDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DeploymentService['updateStatus']> {
    await this.assertOwnsOrder(id, user);
    return this.deploymentService.updateStatus(id, dto, user.sub);
  }

  @Patch(':id/zone')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  async updateZone(
    @Param('id') id: string,
    @Body('courierZone') courierZone: 'intra_state' | 'inter_state' | 'rural',
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DeploymentService['updateZone']> {
    await this.assertOwnsOrder(id, user);
    return this.deploymentService.updateZone(id, courierZone, user.sub);
  }

  @Patch(':id/tracking')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  async updateTracking(
    @Param('id') id: string,
    @Body('trackingNumber') trackingNumber: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<DeploymentService['updateTracking']> {
    await this.assertOwnsOrder(id, user);
    return this.deploymentService.updateTracking(id, trackingNumber, user.sub);
  }
}
