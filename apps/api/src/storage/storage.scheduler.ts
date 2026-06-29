import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { StorageService } from './storage.service';

@Injectable()
export class StorageScheduler {
  private readonly logger = new Logger(StorageScheduler.name);

  constructor(private readonly storageService: StorageService) {}

  /**
   * Runs daily at 02:00 IST (20:30 UTC) to sync current-month storage charges.
   * If a run already exists for the current month, its ledger entries are reversed first
   * and fresh entries are posted with the current device count — keeping charges up to date.
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
