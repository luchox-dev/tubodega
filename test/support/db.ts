// Integration-test harness: a Nest context with PersistenceModule only, and
// `withRollback`, which runs a function inside a real transaction and then
// rolls it back so tests never leave rows behind (spec 06 §5).
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { validate } from '@app/common';
import {
  KyselyFactory,
  KyselyUnitOfWork,
  PersistenceModule,
  TransactionContext,
  type TxScope,
} from '@app/persistence';

class RollbackSentinel extends Error {}

export async function createPersistenceHarness() {
  const mod = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, validate }), PersistenceModule],
  }).compile();
  return {
    uow: mod.get(KyselyUnitOfWork),
    ctx: mod.get(TransactionContext),
    factory: mod.get(KyselyFactory),
    get: <T>(token: unknown): T => mod.get(token as never),
    close: () => mod.close(),
  };
}

export async function withRollback<T>(
  uow: KyselyUnitOfWork,
  scope: TxScope,
  fn: () => Promise<T>,
): Promise<T> {
  let out!: T;
  try {
    await uow.runAs(scope, async () => {
      out = await fn();
      throw new RollbackSentinel();
    });
  } catch (e) {
    if (!(e instanceof RollbackSentinel)) throw e;
  }
  return out;
}
