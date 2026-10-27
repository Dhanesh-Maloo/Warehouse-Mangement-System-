import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LedgerModule } from '../ledger/ledger.module';
import { RateCardModule } from '../rate-card/rate-card.module';
import { AuditModule } from '../audit/audit.module';
import { StorageService } from './storage.service';
import { StorageScheduler } from './storage.scheduler';
import { StorageController } from './storage.controller';
import { InboundBillingService } from './inbound-billing.service';
import { InboundBillingController } from './inbound-billing.controller';

@Module({
  imports: [ScheduleModule.forRoot(), LedgerModule, RateCardModule, AuditModule],
  providers: [StorageService, StorageScheduler, InboundBillingService],
  controllers: [StorageController, InboundBillingController],
  exports: [StorageService],
})
export class StorageModule {}
