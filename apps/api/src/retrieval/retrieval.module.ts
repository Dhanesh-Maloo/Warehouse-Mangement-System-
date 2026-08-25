import { Module } from '@nestjs/common';
import { RetrievalService } from './retrieval.service';
import { RetrievalController } from './retrieval.controller';
import { LedgerModule } from '../ledger/ledger.module';
import { RateCardModule } from '../rate-card/rate-card.module';
import { AuditModule } from '../audit/audit.module';
import { LogisticsModule } from '../logistics/logistics.module';
import { AssetStatusHistoryModule } from '../asset-status-history/asset-status-history.module';

@Module({
  imports: [LedgerModule, RateCardModule, AuditModule, LogisticsModule, AssetStatusHistoryModule],
  providers: [RetrievalService],
  controllers: [RetrievalController],
  exports: [RetrievalService],
})
export class RetrievalModule {}
