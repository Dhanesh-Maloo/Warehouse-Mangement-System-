import { Module } from '@nestjs/common';
import { DeploymentService } from './deployment.service';
import { DeploymentController } from './deployment.controller';
import { LedgerModule } from '../ledger/ledger.module';
import { RateCardModule } from '../rate-card/rate-card.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [LedgerModule, RateCardModule, AuditModule],
  providers: [DeploymentService],
  controllers: [DeploymentController],
  exports: [DeploymentService],
})
export class DeploymentModule {}
