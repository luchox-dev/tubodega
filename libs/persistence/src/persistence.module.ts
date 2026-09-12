import { Module } from '@nestjs/common';
import { UNIT_OF_WORK } from '@app/common';
import { KyselyFactory } from './kysely/kysely.factory.js';
import { KyselyUnitOfWork } from './kysely/kysely.unit-of-work.js';
import { TransactionContext } from './kysely/transaction.context.js';
import { OrganizationDao } from './dao/organization.dao.js';
import { OutboxEventDao } from './dao/outbox-event.dao.js';
import { RefreshTokenDao } from './dao/refresh-token.dao.js';
import { UserDao } from './dao/user.dao.js';
import { UserRoleDao } from './dao/user-role.dao.js';
import { IdempotencyKeyDao } from './dao/idempotency-key.dao.js';
import { ProductDao } from './dao/product.dao.js';
import { ProductCodeDao } from './dao/product-code.dao.js';
import { ProductMediaDao } from './dao/product-media.dao.js';
import { MediaUploadDao } from './dao/media-upload.dao.js';
import { BatchDao } from './dao/batch.dao.js';
import { CustomFieldDefinitionDao } from './dao/custom-field-definition.dao.js';
import { NodeDao } from './dao/node.dao.js';
import { MovementDao } from './dao/movement.dao.js';
import { StockBalanceDao } from './dao/stock-balance.dao.js';

import { KyselyOutboxEventPublisher } from './outbox/outbox-event-publisher.js';
import { KyselyOrganizationRepository } from './repositories/organization.repository.js';
import { KyselySessionRepository } from './repositories/session.repository.js';
import { KyselyUserRepository } from './repositories/user.repository.js';
import { KyselyProductRepository } from './repositories/catalog/product.repository.js';
import { KyselyProductCodeRepository } from './repositories/catalog/product-code.repository.js';
import { KyselyBatchRepository } from './repositories/catalog/batch.repository.js';
import { KyselyCustomFieldRepository } from './repositories/catalog/custom-field.repository.js';

const DAOS = [
  OrganizationDao, UserDao, UserRoleDao, RefreshTokenDao, OutboxEventDao, IdempotencyKeyDao,
  ProductDao, ProductCodeDao, ProductMediaDao, MediaUploadDao, BatchDao,
  CustomFieldDefinitionDao, NodeDao, MovementDao, StockBalanceDao,
];
const ADAPTERS = [
  KyselyOrganizationRepository,
  KyselyUserRepository,
  KyselySessionRepository,
  KyselyOutboxEventPublisher,
  KyselyProductRepository,
  KyselyProductCodeRepository,
  KyselyBatchRepository,
  KyselyCustomFieldRepository,
];

/** Registered once by the root module; no domain library imports it (R-4). */
@Module({
  providers: [
    KyselyFactory,
    TransactionContext,
    KyselyUnitOfWork,
    { provide: UNIT_OF_WORK, useExisting: KyselyUnitOfWork },
    ...DAOS,
    ...ADAPTERS,
  ],
  exports: [KyselyFactory, TransactionContext, KyselyUnitOfWork, UNIT_OF_WORK, ...DAOS, ...ADAPTERS],
})
export class PersistenceModule {}
