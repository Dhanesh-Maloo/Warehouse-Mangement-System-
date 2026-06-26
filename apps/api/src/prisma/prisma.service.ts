import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient, Prisma } from '@prisma/client';
import { getTenantId } from '../common/tenant-context';

// Models that have a clientId field (tenant-scoped)
const TENANT_SCOPED_MODELS = new Set([
  'Asset',
  'ExpectedDelivery',
  'EventLedger',
  'DeploymentOrder',
  'RetrievalRequest',
  'DisposalRequest',
  'StorageAccrualRun',
  'EventSuppression',
  'EndUser',
]);

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    this.$use(async (params: Prisma.MiddlewareParams, next) => {
      const clientId = getTenantId();
      // Only inject clientId on read operations for tenant-scoped models
      // Write operations are already handled explicitly in each service
      if (
        clientId &&
        params.model &&
        TENANT_SCOPED_MODELS.has(params.model) &&
        (params.action === 'findMany' || params.action === 'count' || params.action === 'aggregate')
      ) {
        params.args = params.args ?? {};
        params.args.where = {
          clientId,
          ...params.args.where,
        };
      }
      return next(params);
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
