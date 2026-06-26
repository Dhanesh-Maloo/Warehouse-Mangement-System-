import { Module } from '@nestjs/common';
import { InspectionsService } from './inspections.service';
import { InspectionsController } from './inspections.controller';
import { LedgerModule } from '../ledger/ledger.module';
import { RateCardModule } from '../rate-card/rate-card.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [LedgerModule, RateCardModule, AuditModule],
  providers: [InspectionsService],
  controllers: [InspectionsController],
  exports: [InspectionsService],
})
export class InspectionsModule {}
