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

const DAOS = [OrganizationDao, UserDao, UserRoleDao, RefreshTokenDao, OutboxEventDao];

/** Registered once by the root module; no domain library imports it (R-4). */
@Module({
  providers: [
    KyselyFactory,
    TransactionContext,
    KyselyUnitOfWork,
    { provide: UNIT_OF_WORK, useExisting: KyselyUnitOfWork },
    ...DAOS,
  ],
  exports: [KyselyFactory, TransactionContext, KyselyUnitOfWork, UNIT_OF_WORK, ...DAOS],
})
export class PersistenceModule {}
