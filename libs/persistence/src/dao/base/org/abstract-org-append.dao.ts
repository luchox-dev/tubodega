import type { DB } from '../../../generated/db.js';
import type { Model, New } from '../abstract-read.dao.js';
import type { IOrgAppendDao } from '../interfaces.js';
import { AbstractOrgReadDao } from './abstract-org-read.dao.js';

/**
 * Reads and inserts, scoped by organization. `movement`, `step_completion` and
 * `outbox_event` stop here: they have no `update`, `upsert` or `delete` **in
 * the type**, which a type test asserts (spec 08 §3, §8).
 */
export abstract class AbstractOrgAppendDao<TB extends keyof DB & string, E>
  extends AbstractOrgReadDao<TB, E>
  implements IOrgAppendDao<E, Model<TB>, New<TB>>
{
  /** `org_id` travels inside the row, so no extra parameter is needed. */
  create(data: New<TB>): Promise<Model<TB>> {
    return this.flat.create(data);
  }

  createMany(data: readonly New<TB>[]): Promise<Model<TB>[]> {
    return this.flat.createMany(data);
  }
}
