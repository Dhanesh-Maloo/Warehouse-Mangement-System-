import { Module } from '@nestjs/common';
import { ResaleService } from './resale.service';
import { ResaleController } from './resale.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { AssetStatusHistoryModule } from '../asset-status-history/asset-status-history.module';
import { UsersModule } from '../users/users.module';

// Resale is a non-billable inventory movement (like the US-INV-03 location
// move feature) — no LedgerModule or RateCardModule dependency here.
@Module({
  imports: [PrismaModule, AuditModule, AssetStatusHistoryModule, UsersModule],
  providers: [ResaleService],
  controllers: [ResaleController],
  exports: [ResaleService],
})
export class ResaleModule {}
