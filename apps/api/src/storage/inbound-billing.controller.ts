import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InboundBillingService } from './inbound-billing.service';
import { MarkInboundBilledDto } from './dto/mark-inbound-billed.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('inbound-billing')
export class InboundBillingController {
  constructor(private readonly service: InboundBillingService) {}

  /**
   * GET /inbound-billing/pending?clientId= — devices with no inbound charge yet, plus history.
   * client_admin is read-only and forced to their own clientId.
   */
  @Get('pending')
  @Roles('admin', 'manager', 'client_admin')
  getPending(
    @Query('clientId', ParseUUIDPipe) clientId: string,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<InboundBillingService['getPending']> {
    const effectiveClientId = user.role === 'client_admin' ? (user.clientId ?? '') : clientId;
    return this.service.getPending(effectiveClientId);
  }

  /** POST /inbound-billing/mark-billed — admin/manager; ticks the pending devices as billed. */
  @Post('mark-billed')
  @Roles('admin', 'manager')
  markBilled(
    @Body() dto: MarkInboundBilledDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<InboundBillingService['markBilled']> {
    return this.service.markBilled(dto.clientId, dto.billingMonth, user.sub);
  }

  /** DELETE /inbound-billing/:id — admin/manager; un-ticks a billed batch. */
  @Delete(':id')
  @HttpCode(204)
  @Roles('admin', 'manager')
  undo(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload): Promise<void> {
    return this.service.undo(id, user.sub);
  }
}
