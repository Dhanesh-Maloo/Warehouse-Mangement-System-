import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { StorageService } from './storage.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload.type';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('storage')
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  /**
   * GET /storage/summary
   * Returns current in-storage device counts and projected monthly cost.
   * client_user/editor are forced to their own clientId; admin/manager/operator may pass ?clientId=.
   */
  @Get('summary')
  @Roles('admin', 'manager', 'operator', 'client_user', 'editor')
  getSummary(
    @Query('clientId') clientId?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<StorageService['getStorageSummary']> {
    const effectiveClientId =
      user?.role === 'client_user' || user?.role === 'editor'
        ? (user.clientId ?? '')
        : (clientId ?? '');
    return this.storageService.getStorageSummary(effectiveClientId);
  }

  /**
   * GET /storage/accrual-runs
   * Returns recent accrual run history. Optionally filter by ?clientId=.
   * editor is forced to their own clientId; admin/manager may pass ?clientId=.
   */
  @Get('accrual-runs')
  @Roles('admin', 'manager', 'editor')
  getAccrualRuns(
    @Query('clientId') clientId?: string,
    @CurrentUser() user?: JwtPayload,
  ): ReturnType<StorageService['getAccrualRuns']> {
    const effectiveClientId = user?.role === 'editor' ? (user.clientId ?? undefined) : clientId;
    return this.storageService.getAccrualRuns(effectiveClientId);
  }

  /**
   * POST /storage/run-accrual
   * Manually triggers the monthly storage accrual job.
   * Restricted to admin only.
   */
  @Post('run-accrual')
  @Roles('admin')
  runAccrual(): ReturnType<StorageService['runMonthlyAccrual']> {
    return this.storageService.runMonthlyAccrual();
  }
}
