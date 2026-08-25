import { Module } from '@nestjs/common';
import { DisposalService } from './disposal.service';
import { DisposalController } from './disposal.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { LedgerModule } from '../ledger/ledger.module';
import { RateCardModule } from '../rate-card/rate-card.module';
import { AuditModule } from '../audit/audit.module';
import { AssetStatusHistoryModule } from '../asset-status-history/asset-status-history.module';

@Module({
  imports: [PrismaModule, LedgerModule, RateCardModule, AuditModule, AssetStatusHistoryModule],
  providers: [DisposalService],
  controllers: [DisposalController],
  exports: [DisposalService],
})
export class DisposalModule {}
