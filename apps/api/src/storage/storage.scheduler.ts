import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StorageService } from './storage.service';

@Injectable()
export class StorageScheduler {
  private readonly logger = new Logger(StorageScheduler.name);

  constructor(private readonly storageService: StorageService) {}

  /**
   * Runs daily at 02:00 IST (20:30 UTC) to sync current-month storage charges.
   * Each run overwrites the previous run for the same calendar month, so no duplicates accumulate.
   */
  @Cron('30 20 * * *')
  async runMonthlyAccrual(): Promise<void> {
    this.logger.log('Daily storage accrual triggered by cron schedule');
    try {
      const result = await this.storageService.runMonthlyAccrual();
      this.logger.log(
        `Storage accrual complete — ${result.totalClients} client(s) processed, ${result.clientsBelowCommitment} below minimum commitment.`,
      );
    } catch (err) {
      this.logger.error(`Storage accrual job failed: ${String(err)}`);
    }
  }
}
