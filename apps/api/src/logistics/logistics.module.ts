import { Module } from '@nestjs/common';
import { CourierZoneService } from './courier-zone.service';
import { LogisticsController } from './logistics.controller';

@Module({
  providers: [CourierZoneService],
  controllers: [LogisticsController],
  exports: [CourierZoneService],
})
export class LogisticsModule {}
