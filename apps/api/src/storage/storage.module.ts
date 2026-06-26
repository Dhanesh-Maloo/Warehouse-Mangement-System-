import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { LedgerModule } from '../ledger/ledger.module';
import { RateCardModule } from '../rate-card/rate-card.module';
import { StorageService } from './storage.service';
import { StorageScheduler } from './storage.scheduler';
import { StorageController } from './storage.controller';

@Module({
  imports: [ScheduleModule.forRoot(), LedgerModule, RateCardModule],
  providers: [StorageService, StorageScheduler],
  controllers: [StorageController],
  exports: [StorageService],
})
export class StorageModule {}
