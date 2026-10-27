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

  /**
   * POST /inbound-billing/mark-billed — ticks the pending devices as billed.
   * client_admin is forced to their own clientId.
   */
  @Post('mark-billed')
  @Roles('admin', 'manager', 'client_admin')
  markBilled(
    @Body() dto: MarkInboundBilledDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<InboundBillingService['markBilled']> {
    const clientId = user.role === 'client_admin' ? (user.clientId ?? '') : dto.clientId;
    return this.service.markBilled(clientId, dto.billingMonth, user.sub);
  }

  /** DELETE /inbound-billing/:id — un-ticks a billed batch; client_admin only for their own client. */
  @Delete(':id')
  @HttpCode(204)
  @Roles('admin', 'manager', 'client_admin')
  undo(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload): Promise<void> {
    const scopeClientId = user.role === 'client_admin' ? (user.clientId ?? '') : undefined;
    return this.service.undo(id, user.sub, scopeClientId);
  }
}
