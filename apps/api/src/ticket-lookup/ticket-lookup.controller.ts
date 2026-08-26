import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { TicketLookupService } from './ticket-lookup.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('ticket-lookup')
export class TicketLookupController {
  constructor(private readonly ticketLookupService: TicketLookupService) {}

  @Get()
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor', 'client_admin')
  lookup(
    @Query('q') q: string | undefined,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<TicketLookupService['lookup']> {
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor' || user?.role === 'client_admin'
        ? (user.clientId ?? undefined)
        : undefined;
    return this.ticketLookupService.lookup(q ?? '', effectiveClientId);
  }
}
