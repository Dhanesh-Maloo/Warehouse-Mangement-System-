import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InspectionsService } from './inspections.service';

@Injectable()
export class InspectionsScheduler {
  private readonly logger = new Logger(InspectionsScheduler.name);

  constructor(private readonly inspectionsService: InspectionsService) {}

  /** Runs every 15 minutes to check for newly SLA-breached inspections. */
  @Cron('*/15 * * * *')
  async checkSlaBreaches(): Promise<void> {
    try {
      const count = await this.inspectionsService.findAndNotifyBreachedInspections();
      if (count > 0) {
        this.logger.log(`Sent SLA-breach notification for ${count} inspection(s).`);
      }
    } catch (err) {
      this.logger.error(`Inspection SLA-breach check failed: ${String(err)}`);
    }
  }
}
