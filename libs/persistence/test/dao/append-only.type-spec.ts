// I-3 is defended in the type, not only by the REVOKE (spec 08 §3, §8): an
// append-only DAO that inherited `update` would have the method in its type
// and someone would eventually call it. This file is checked by
// `pnpm typecheck`, before a database exists; vitest does not run it.
import { expectTypeOf } from 'vitest';
import { OutboxEventDao, UserDao } from '@app/persistence';

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
