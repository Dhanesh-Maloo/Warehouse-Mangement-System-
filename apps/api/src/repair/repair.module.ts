import { Module } from '@nestjs/common';
import { RepairService } from './repair.service';
import { RepairController } from './repair.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { LedgerModule } from '../ledger/ledger.module';
import { RateCardModule } from '../rate-card/rate-card.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [PrismaModule, LedgerModule, RateCardModule, AuditModule],
  providers: [RepairService],
  controllers: [RepairController],
  exports: [RepairService],
})
export class RepairModule {}
