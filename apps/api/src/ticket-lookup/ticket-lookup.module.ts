import { Module } from '@nestjs/common';
import { TicketLookupService } from './ticket-lookup.service';
import { TicketLookupController } from './ticket-lookup.controller';

@Module({
  providers: [TicketLookupService],
  controllers: [TicketLookupController],
})
export class TicketLookupModule {}
