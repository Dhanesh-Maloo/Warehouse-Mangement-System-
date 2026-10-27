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

  /** GET /inbound-billing/pending?clientId= — devices with no inbound charge yet, plus history. */
  @Get('pending')
  @Roles('admin', 'manager')
  getPending(
    @Query('clientId', ParseUUIDPipe) clientId: string,
  ): ReturnType<InboundBillingService['getPending']> {
    return this.service.getPending(clientId);
  }

  /** POST /inbound-billing/mark-billed — admin only; ticks the pending devices as billed. */
  @Post('mark-billed')
  @Roles('admin')
  markBilled(
    @Body() dto: MarkInboundBilledDto,
    @CurrentUser() user: JwtPayload,
  ): ReturnType<InboundBillingService['markBilled']> {
    return this.service.markBilled(dto.clientId, dto.billingMonth, user.sub);
  }

  /** DELETE /inbound-billing/:id — admin only; un-ticks a billed batch. */
  @Delete(':id')
  @HttpCode(204)
  @Roles('admin')
  undo(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: JwtPayload): Promise<void> {
    return this.service.undo(id, user.sub);
  }
}
