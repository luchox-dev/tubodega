import { Global, Module } from '@nestjs/common';
import { CLOCK, EVENT_PUBLISHER, ID_GENERATOR, SystemClock, Uuidv7Generator } from '@app/common';
import {
  BATCH_REPOSITORY, CUSTOM_FIELD_REPOSITORY, MOVEMENT_COUNTER,
  PRODUCT_CODE_REPOSITORY, PRODUCT_REPOSITORY, STOCK_CHECKER,
} from '@app/catalog';
import {
  KyselyBatchRepository,
  KyselyCustomFieldRepository,
  KyselyOrganizationRepository,
  KyselyOutboxEventPublisher,
  KyselyProductCodeRepository,
  KyselyProductRepository,
  KyselySessionRepository,
  KyselyUserRepository,
  PersistenceModule,
} from '@app/persistence';
import { ORGANIZATION_REPOSITORY, ORG_PROVISIONER, SESSION_REPOSITORY, USER_REPOSITORY } from '@app/tenancy';
import { CompositeOrgProvisioner, ORG_SEEDERS } from './tenancy/org-provisioner.adapter.js';
import { MovementCounterAdapter } from './catalog/movement-counter.adapter.js';
import { StockCheckerAdapter } from './catalog/stock-checker.adapter.js';

/**
 * The composition root's port ↔ adapter table (spec 01 §6). Global so that
 * library modules resolve their ports without importing persistence (R-4).
 */
@Global()
@Module({
  imports: [PersistenceModule],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: Uuidv7Generator },
    { provide: EVENT_PUBLISHER, useExisting: KyselyOutboxEventPublisher },
    { provide: ORGANIZATION_REPOSITORY, useExisting: KyselyOrganizationRepository },
    { provide: USER_REPOSITORY, useExisting: KyselyUserRepository },
    { provide: SESSION_REPOSITORY, useExisting: KyselySessionRepository },
    { provide: ORG_SEEDERS, useValue: [] },
    { provide: ORG_PROVISIONER, useClass: CompositeOrgProvisioner },
    { provide: PRODUCT_REPOSITORY, useExisting: KyselyProductRepository },
    { provide: PRODUCT_CODE_REPOSITORY, useExisting: KyselyProductCodeRepository },
    { provide: BATCH_REPOSITORY, useExisting: KyselyBatchRepository },
    { provide: CUSTOM_FIELD_REPOSITORY, useExisting: KyselyCustomFieldRepository },
    MovementCounterAdapter,
    StockCheckerAdapter,
    { provide: MOVEMENT_COUNTER, useExisting: MovementCounterAdapter },
    { provide: STOCK_CHECKER, useExisting: StockCheckerAdapter },
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
    MOVEMENT_COUNTER,
    STOCK_CHECKER,
  ],
})
export class AdaptersModule {}
