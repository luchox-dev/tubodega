import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import type { OrgId, UnitOfWork } from '@app/common';
import { KyselyFactory } from './kysely.factory.js';
import { NoActiveTransactionError } from './errors.js';
import { TransactionContext, type Tx } from './transaction.context.js';

/** Who opens a root transaction always knows its pool and organization (decision D-13). */
export type TxScope =
  | { readonly pool: 'tenant'; readonly orgId: OrgId }
  | { readonly pool: 'system'; readonly orgId?: OrgId };

interface SavepointHandle {
  releaseSavepoint(name: string): { execute(): Promise<unknown> };
  rollbackToSavepoint(name: string): { execute(): Promise<unknown> };
}
interface SavepointCapable {
  savepoint(name: string): { execute(): Promise<SavepointHandle> };
}

export interface TxOptions {
  readonly readOnly?: boolean;
}

/**
 * Implements the `UnitOfWork` port of common.
 * - `run()`   nests: SAVEPOINT / RELEASE / ROLLBACK TO. Outside a transaction it throws.
 * - `runAs()` opens a root transaction on a pool and, when an organization is
 *   given, `SET LOCAL app.current_org` before anything else runs (T-5).
 * - `runDetached()` opens a short transaction on the dedicated pool with a fresh
 *   async context, so it neither sees nor waits on the ambient one (D-9).
 */
@Injectable()
export class KyselyUnitOfWork implements UnitOfWork {
  private savepointSeq = 0;

  constructor(
    private readonly factory: KyselyFactory,
    private readonly ctx: TransactionContext,
  ) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.ctx.has()) throw new NoActiveTransactionError();
    // Kysely types savepoint names as literals; ours are generated, so we go
    // through a structural view of the same object.
    const tx = this.ctx.current() as unknown as SavepointCapable;
    const name = `sp_${++this.savepointSeq}`;
    const sp = await tx.savepoint(name).execute();
    try {
      const out = await fn();
      await sp.releaseSavepoint(name).execute();
      return out;
    } catch (e) {
      await sp.rollbackToSavepoint(name).execute();
      throw e;
    }
  }

  async runAs<T>(scope: TxScope, fn: () => Promise<T>, opts: TxOptions = {}): Promise<T> {
    if (this.ctx.has()) throw new Error('runAs() called inside an active transaction');
    return this.open(this.factory.get(scope.pool), scope.orgId, opts, fn);
  }

  async runDetached<T>(scope: { readonly orgId: OrgId }, fn: () => Promise<T>): Promise<T> {
    return this.open(this.factory.get('detached'), scope.orgId, {}, fn);
  }

  private async open<T>(
    db: ReturnType<KyselyFactory['get']>,
    orgId: OrgId | undefined,
    opts: TxOptions,
    fn: () => Promise<T>,
  ): Promise<T> {
    const tx: Tx = await db
      .startTransaction()
      .setAccessMode(opts.readOnly ? 'read only' : 'read write')
      .execute();
    try {
      if (orgId) {
        // set_config(..., true) is SET LOCAL with a parameter: it dies with the transaction (spec 04 §4).
        await sql`select set_config('app.current_org', ${orgId}, true)`.execute(tx);
      }
      const out = await this.ctx.runWith(tx, fn);
      await tx.commit().execute();
      return out;
    } catch (e) {
      await tx.rollback().execute();
      throw e;
    }
  }
}
