import { Module } from '@nestjs/common';
import { InboundService } from './inbound.service';
import { InboundController } from './inbound.controller';
import { LedgerModule } from '../ledger/ledger.module';
import { RateCardModule } from '../rate-card/rate-card.module';
import { AuditModule } from '../audit/audit.module';
import { AssetStatusHistoryModule } from '../asset-status-history/asset-status-history.module';

@Module({
  imports: [LedgerModule, RateCardModule, AuditModule, AssetStatusHistoryModule],
  providers: [InboundService],
  controllers: [InboundController],
  exports: [InboundService],
})
export class InboundModule {}
