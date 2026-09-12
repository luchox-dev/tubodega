import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CLOCK, EVENT_PUBLISHER, ID_GENERATOR, SystemClock, Uuidv7Generator,
  type EnvironmentVariables,
} from '@app/common';
import {
  BATCH_REPOSITORY, CUSTOM_FIELD_REPOSITORY, DiskMediaStorage, MEDIA_ROOT,
  MEDIA_STORAGE, MEDIA_UPLOAD_REPOSITORY, MOVEMENT_COUNTER, PRODUCT_CODE_REPOSITORY,
  PRODUCT_MEDIA_REPOSITORY, PRODUCT_REPOSITORY, STOCK_CHECKER,
} from '@app/catalog';
import {
  KyselyBatchRepository,
  KyselyCustomFieldRepository,
  KyselyMediaUploadRepository,
  KyselyOrganizationRepository,
  KyselyOutboxEventPublisher,
  KyselyProductCodeRepository,
  KyselyProductMediaRepository,
  KyselyNodeRepository,
  KyselyProductRepository,
  KyselySessionRepository,
  KyselyStockBalanceRepository,
  KyselyUserRepository,
  PersistenceModule,
} from '@app/persistence';
import { ORGANIZATION_REPOSITORY, ORG_PROVISIONER, SESSION_REPOSITORY, USER_REPOSITORY } from '@app/tenancy';
import { InventoryModule, NODE_REPOSITORY, STOCK_BALANCE_REPOSITORY } from '@app/inventory';
import { BoundaryNodesSeeder } from './inventory/boundary-nodes.seeder.js';
import { CompositeOrgProvisioner, ORG_SEEDERS, type OrgSeeder } from './tenancy/org-provisioner.adapter.js';
import { MovementCounterAdapter } from './catalog/movement-counter.adapter.js';
import { StockCheckerAdapter } from './catalog/stock-checker.adapter.js';

/**
 * The composition root's port ↔ adapter table (spec 01 §6). Global so that
 * library modules resolve their ports without importing persistence (R-4).
 */
@Global()
@Module({
  imports: [PersistenceModule, InventoryModule],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: Uuidv7Generator },
    { provide: EVENT_PUBLISHER, useExisting: KyselyOutboxEventPublisher },
    { provide: ORGANIZATION_REPOSITORY, useExisting: KyselyOrganizationRepository },
    { provide: USER_REPOSITORY, useExisting: KyselyUserRepository },
    { provide: SESSION_REPOSITORY, useExisting: KyselySessionRepository },
    BoundaryNodesSeeder,
    {
      provide: ORG_SEEDERS,
      // useFactory and not useValue: useValue would hand the composite the
      // classes instead of the instances, and seeder.seed() would blow up at
      // runtime. Plans 8 and 9 extend this with one entry in `inject` and one
      // parameter here (decision D-2).
      inject: [BoundaryNodesSeeder],
      useFactory: (nodes: BoundaryNodesSeeder): readonly OrgSeeder[] => [nodes],
    },
    { provide: ORG_PROVISIONER, useClass: CompositeOrgProvisioner },
    { provide: PRODUCT_REPOSITORY, useExisting: KyselyProductRepository },
    { provide: PRODUCT_CODE_REPOSITORY, useExisting: KyselyProductCodeRepository },
    { provide: BATCH_REPOSITORY, useExisting: KyselyBatchRepository },
    { provide: CUSTOM_FIELD_REPOSITORY, useExisting: KyselyCustomFieldRepository },
    { provide: NODE_REPOSITORY, useExisting: KyselyNodeRepository },
    { provide: STOCK_BALANCE_REPOSITORY, useExisting: KyselyStockBalanceRepository },
    MovementCounterAdapter,
    StockCheckerAdapter,
    { provide: MOVEMENT_COUNTER, useExisting: MovementCounterAdapter },
    { provide: STOCK_CHECKER, useExisting: StockCheckerAdapter },
    { provide: MEDIA_UPLOAD_REPOSITORY, useExisting: KyselyMediaUploadRepository },
    { provide: PRODUCT_MEDIA_REPOSITORY, useExisting: KyselyProductMediaRepository },
    {
      provide: MEDIA_ROOT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) =>
        config.get('MEDIA_ROOT', { infer: true }),
    },
    { provide: MEDIA_STORAGE, useClass: DiskMediaStorage },
  ],
  exports: [
    PersistenceModule,
    CLOCK,
    ID_GENERATOR,
    EVENT_PUBLISHER,
    ORGANIZATION_REPOSITORY,
    USER_REPOSITORY,
    SESSION_REPOSITORY,
    ORG_PROVISIONER,
    PRODUCT_REPOSITORY,
    PRODUCT_CODE_REPOSITORY,
    BATCH_REPOSITORY,
    CUSTOM_FIELD_REPOSITORY,
    NODE_REPOSITORY,
    STOCK_BALANCE_REPOSITORY,
    MOVEMENT_COUNTER,
    STOCK_CHECKER,
    MEDIA_UPLOAD_REPOSITORY,
    PRODUCT_MEDIA_REPOSITORY,
    MEDIA_STORAGE,
  ],
})
export class AdaptersModule {}
