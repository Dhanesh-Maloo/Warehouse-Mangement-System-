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
import { ResaleService } from './resale.service';
import { CreateResaleListingDto } from './dto/create-resale-listing.dto';
import { UpdateResaleStatusDto } from './dto/update-resale-status.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

@Controller('resale')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ResaleController {
  constructor(private readonly resaleService: ResaleService) {}

  private static isClientScoped(role: string): boolean {
    return role === 'client_user' || role === 'editor' || role === 'client_admin';
  }

  private async assertOwnsListing(id: string, user: JwtPayload): Promise<void> {
    if (!ResaleController.isClientScoped(user.role)) return;
    const listing = await this.resaleService.findOne(id);
    if (listing.clientId !== user.clientId) {
      throw new ForbiddenException('Cannot act on a resale listing from another client');
    }
  }

  @Get()
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  findAll(
    @Query('clientId') clientId?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<ResaleService['findAll']> {
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor' || user?.role === 'client_admin'
        ? (user.clientId ?? undefined)
        : clientId;
    return this.resaleService.findAll(effectiveClientId);
  }

  @Get('asset/:assetId')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  findByAsset(
    @Param('assetId') assetId: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<ResaleService['findByAsset']> {
    const clientId = ResaleController.isClientScoped(user.role)
      ? (user.clientId ?? undefined)
      : undefined;
    return this.resaleService.findByAsset(assetId, clientId);
  }

  @Get(':id')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<ResaleService['findOne']> {
    await this.assertOwnsListing(id, user);
    return this.resaleService.findOne(id);
  }

  @Post()
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  create(
    @Body() dto: CreateResaleListingDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<ResaleService['create']> {
    // editors/client_admins can only list assets belonging to their own client
    if ((user.role === 'editor' || user.role === 'client_admin') && user.clientId) {
      dto.clientId = user.clientId;
    }
    return this.resaleService.create(dto, user.sub);
  }

  @Patch(':id/status')
  @Roles('admin', 'manager', 'operator', 'editor', 'client_admin')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateResaleStatusDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<ResaleService['updateStatus']> {
    await this.assertOwnsListing(id, user);
    return this.resaleService.updateStatus(id, dto, user.sub);
  }
}
