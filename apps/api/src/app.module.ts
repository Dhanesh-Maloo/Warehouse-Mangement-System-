import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { TenantMiddleware } from './common/tenant.middleware';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './health/health.module';
import { LedgerModule } from './ledger/ledger.module';
import { AuthModule } from './auth/auth.module';
import { ClientsModule } from './clients/clients.module';
import { UsersModule } from './users/users.module';
import { AssetsModule } from './assets/assets.module';
import { InboundModule } from './inbound/inbound.module';
import { InspectionsModule } from './inspections/inspections.module';
import { InventoryModule } from './inventory/inventory.module';
import { RateCardModule } from './rate-card/rate-card.module';
import { AuditModule } from './audit/audit.module';
import { LocationsModule } from './locations/locations.module';
import { EndUsersModule } from './end-users/end-users.module';
import { DisposalModule } from './disposal/disposal.module';
import { RetrievalModule } from './retrieval/retrieval.module';
import { DeploymentModule } from './deployment/deployment.module';
import { RepairModule } from './repair/repair.module';
import { ResaleModule } from './resale/resale.module';
import { StorageModule } from './storage/storage.module';
import { DemoModule } from './demo/demo.module';
import { DocumentsModule } from './documents/documents.module';
import { R2Module } from './r2/r2.module';
import { LogisticsModule } from './logistics/logistics.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['../../.env', '.env'] }),
    R2Module,
    PrismaModule,
    HealthModule,
    LedgerModule,
    AuthModule,
    ClientsModule,
    UsersModule,
    AssetsModule,
    InboundModule,
    InspectionsModule,
    InventoryModule,
    RateCardModule,
    AuditModule,
    LocationsModule,
    EndUsersModule,
    DisposalModule,
    RetrievalModule,
    DeploymentModule,
    RepairModule,
    ResaleModule,
    StorageModule,
    DemoModule,
    DocumentsModule,
    LogisticsModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantMiddleware).forRoutes('*');
  }
}
