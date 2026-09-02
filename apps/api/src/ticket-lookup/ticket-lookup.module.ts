import { Module } from '@nestjs/common';
import { TicketLookupService } from './ticket-lookup.service';
import { TicketLookupController } from './ticket-lookup.controller';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [LedgerModule],
  providers: [TicketLookupService],
  controllers: [TicketLookupController],
})
export class TicketLookupModule {}
