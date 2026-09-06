import { Module } from '@nestjs/common';
import { UNIT_OF_WORK } from '@app/common';
import { KyselyFactory } from './kysely/kysely.factory.js';
import { KyselyUnitOfWork } from './kysely/kysely.unit-of-work.js';
import { TransactionContext } from './kysely/transaction.context.js';

/** Registered once by the root module; no domain library imports it (R-4). */
@Module({
  providers: [
    KyselyFactory,
    TransactionContext,
    KyselyUnitOfWork,
    { provide: UNIT_OF_WORK, useExisting: KyselyUnitOfWork },
  ],
  exports: [KyselyFactory, TransactionContext, KyselyUnitOfWork, UNIT_OF_WORK],
})
export class PersistenceModule {}
