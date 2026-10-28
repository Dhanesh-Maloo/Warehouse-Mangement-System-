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
import type { ChargeBillingBatch } from '@prisma/client';
import { ChargeBillingService, type ChargeBillingState } from './charge-billing.service';
import { MarkChargesBilledDto } from './dto/mark-charges-billed.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

const CLIENT_SCOPED_ROLES = new Set(['client_user', 'editor', 'client_admin']);

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('charge-billing')
export class ChargeBillingController {
  constructor(private readonly service: ChargeBillingService) {}

  /** GET /charge-billing?clientId= — billed charge ids and batch history. Client users are forced to their own client. */
  @Get()
  @Roles('admin', 'manager', 'client_user', 'editor', 'client_admin')
  getState(
    @Query('clientId', ParseUUIDPipe) clientId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<ChargeBillingState> {
    const effectiveClientId = CLIENT_SCOPED_ROLES.has(user.role) ? (user.clientId ?? '') : clientId;
    return this.service.getState(effectiveClientId);
  }

  /** POST /charge-billing/mark-billed — client_admin is forced to their own client. */
  @Post('mark-billed')
  @Roles('admin', 'manager', 'client_admin')
  markBilled(
    @Body() dto: MarkChargesBilledDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<ChargeBillingBatch> {
    const clientId = user.role === 'client_admin' ? (user.clientId ?? '') : dto.clientId;
    return this.service.markBilled(clientId, dto.category, dto.eventIds, user.sub);
  }

  /** DELETE /charge-billing/:id — un-bills a batch; client_admin only for their own client. */
  @Delete(':id')
  @HttpCode(204)
  @Roles('admin', 'manager', 'client_admin')
  undo(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload): Promise<void> {
    const scopeClientId = user.role === 'client_admin' ? (user.clientId ?? '') : undefined;
    return this.service.undo(id, user.sub, scopeClientId);
  }
}
