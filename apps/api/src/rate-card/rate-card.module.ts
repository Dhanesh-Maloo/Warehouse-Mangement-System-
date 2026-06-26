import { Module } from '@nestjs/common';
import { RateCardService } from './rate-card.service';
import { RateCardController } from './rate-card.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [RateCardService],
  controllers: [RateCardController],
  exports: [RateCardService],
})
export class RateCardModule {}
