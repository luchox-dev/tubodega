// I-3 is defended in the type, not only by the REVOKE (spec 08 §3, §8): an
// append-only DAO that inherited `update` would have the method in its type
// and someone would eventually call it. This file is checked by
// `pnpm typecheck`, before a database exists; vitest does not run it.
import { expectTypeOf } from 'vitest';
import { KyselyMovementRepository, MovementDao, OutboxEventDao, UserDao } from '@app/persistence';

expectTypeOf<OutboxEventDao>().not.toHaveProperty('update');
expectTypeOf<OutboxEventDao>().not.toHaveProperty('updateMany');
expectTypeOf<OutboxEventDao>().not.toHaveProperty('upsert');
expectTypeOf<OutboxEventDao>().not.toHaveProperty('delete');
expectTypeOf<OutboxEventDao>().not.toHaveProperty('deleteMany');

// It does keep the reads and the inserts.
expectTypeOf<OutboxEventDao>().toHaveProperty('create');
expectTypeOf<OutboxEventDao>().toHaveProperty('findPage');

// A mutable table has the full set.
expectTypeOf<UserDao>().toHaveProperty('update');
expectTypeOf<UserDao>().toHaveProperty('delete');

// The ledger stops at the append family for the same reason, and it matters
// more here: `movement` is the history. UPDATE and DELETE are also revoked in
// the database (I-3), but a type error arrives years earlier than a 42501.
expectTypeOf<MovementDao>().not.toHaveProperty('update');
expectTypeOf<MovementDao>().not.toHaveProperty('delete');
expectTypeOf<MovementDao>().not.toHaveProperty('deleteMany');
expectTypeOf<MovementDao>().not.toHaveProperty('upsert');
expectTypeOf<MovementDao>().toHaveProperty('create');
expectTypeOf<MovementDao>().toHaveProperty('countByProduct');

// And the port above it, which is the layer a use case actually sees. A
// programmer who wants to modify a movement does not find the method here
// either, and that is the moment they read spec 12 and understand they must
// compensate — the layer of I-3 that arrives years before a 42501.
expectTypeOf<KyselyMovementRepository>().not.toHaveProperty('update');
expectTypeOf<KyselyMovementRepository>().not.toHaveProperty('delete');
expectTypeOf<KyselyMovementRepository>().toHaveProperty('append');
expectTypeOf<KyselyMovementRepository>().toHaveProperty('appendMany');
