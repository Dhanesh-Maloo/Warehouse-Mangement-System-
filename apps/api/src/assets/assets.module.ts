import { Module } from '@nestjs/common';
import { AssetsService } from './assets.service';
import { AssetsController } from './assets.controller';
import { AssetStatusHistoryModule } from '../asset-status-history/asset-status-history.module';
import { LedgerModule } from '../ledger/ledger.module';

@Module({
  imports: [AssetStatusHistoryModule, LedgerModule],
  providers: [AssetsService],
  controllers: [AssetsController],
  exports: [AssetsService],
})
export class AssetsModule {}
