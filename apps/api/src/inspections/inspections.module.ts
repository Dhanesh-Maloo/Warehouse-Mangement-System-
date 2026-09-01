import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { InspectionsService } from './inspections.service';
import { InspectionsController } from './inspections.controller';
import { InspectionsScheduler } from './inspections.scheduler';
import { LedgerModule } from '../ledger/ledger.module';
import { RateCardModule } from '../rate-card/rate-card.module';
import { AuditModule } from '../audit/audit.module';
import { R2Module } from '../r2/r2.module';
import { DeploymentModule } from '../deployment/deployment.module';
import { AssetStatusHistoryModule } from '../asset-status-history/asset-status-history.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    LedgerModule,
    RateCardModule,
    AuditModule,
    R2Module,
    DeploymentModule,
    AssetStatusHistoryModule,
  ],
  providers: [InspectionsService, InspectionsScheduler],
  controllers: [InspectionsController],
  exports: [InspectionsService],
})
export class InspectionsModule {}
