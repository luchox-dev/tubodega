import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { ControlledTransaction } from 'kysely';
import type { DB } from '../generated/db.js';
import { NoActiveTransactionError } from './errors.js';

export type Tx = ControlledTransaction<DB, string[]>;

/**
 * The ambient transaction (spec 07 §4). DAOs read the active transaction from
 * here and never fall back to a pool: in the tenant pool a query without
 * SET LOCAL app.current_org fails under RLS, and in the system pool it would
 * read every organization.
 */
@Injectable()
export class TransactionContext {
  private readonly als = new AsyncLocalStorage<{ tx: Tx }>();

  has(): boolean {
    return this.als.getStore() !== undefined;
  }

  current(): Tx {
    const store = this.als.getStore();
    if (!store) throw new NoActiveTransactionError();
    return store.tx;
  }

  runWith<T>(tx: Tx, fn: () => Promise<T>): Promise<T> {
    return this.als.run({ tx }, fn);
  }
}
