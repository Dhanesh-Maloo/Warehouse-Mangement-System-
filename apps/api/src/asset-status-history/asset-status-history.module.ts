import { Module } from '@nestjs/common';
import { AssetStatusHistoryService } from './asset-status-history.service';

@Module({
  providers: [AssetStatusHistoryService],
  exports: [AssetStatusHistoryService],
})
export class AssetStatusHistoryModule {}
