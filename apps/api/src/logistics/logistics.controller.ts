import { Controller, Get, Post, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { CourierZoneService, type CourierZone } from './courier-zone.service';
import { AddRuralPincodeDto } from './dto/add-rural-pincode.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

@Controller('logistics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class LogisticsController {
  constructor(private readonly courierZone: CourierZoneService) {}

  /** Preview the courier zone for a pincode — used for live cost estimates before an order is created. */
  @Get('resolve-zone')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  async resolveZone(@Query('pincode') pincode: string): Promise<{ zone: CourierZone }> {
    // Nest sends a bare string handler result as raw text, not JSON —
    // wrap it in an object so the response is always valid JSON.
    const zone = await this.courierZone.resolveZone(pincode);
    return { zone };
  }

  @Get('rural-pincodes')
  @Roles('admin', 'manager')
  listRuralPincodes(): ReturnType<CourierZoneService['listRuralPincodes']> {
    return this.courierZone.listRuralPincodes();
  }

  @Post('rural-pincodes')
  @Roles('admin', 'manager')
  addRuralPincode(
    @Body() dto: AddRuralPincodeDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<CourierZoneService['addRuralPincode']> {
    return this.courierZone.addRuralPincode(dto.pincode, dto.note, user.sub);
  }

  @Delete('rural-pincodes/:pincode')
  @Roles('admin', 'manager')
  removeRuralPincode(
    @Param('pincode') pincode: string,
  ): ReturnType<CourierZoneService['removeRuralPincode']> {
    return this.courierZone.removeRuralPincode(pincode);
  }
}
