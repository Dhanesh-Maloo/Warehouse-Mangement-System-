import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ChargeBillingService } from './charge-billing.service';
import { ChargeBillingController } from './charge-billing.controller';

@Module({
  imports: [AuditModule],
  providers: [ChargeBillingService],
  controllers: [ChargeBillingController],
})
export class ChargeBillingModule {}
