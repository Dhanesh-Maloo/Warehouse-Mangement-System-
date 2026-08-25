import { Module } from '@nestjs/common';
import { InspectionsService } from './inspections.service';
import { InspectionsController } from './inspections.controller';
import { LedgerModule } from '../ledger/ledger.module';
import { RateCardModule } from '../rate-card/rate-card.module';
import { AuditModule } from '../audit/audit.module';
import { R2Module } from '../r2/r2.module';
import { DeploymentModule } from '../deployment/deployment.module';
import { AssetStatusHistoryModule } from '../asset-status-history/asset-status-history.module';

@Module({
  imports: [
    LedgerModule,
    RateCardModule,
    AuditModule,
    R2Module,
    DeploymentModule,
    AssetStatusHistoryModule,
  ],
  providers: [InspectionsService],
  controllers: [InspectionsController],
  exports: [InspectionsService],
})
export class InspectionsModule {}
