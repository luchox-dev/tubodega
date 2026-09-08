import type { OrgId } from '@app/common';
import type { DB } from '../../../generated/db.js';
import type { Model, New, Patch } from '../abstract-read.dao.js';
import type { IOrgDao, UpdateOpts } from '../interfaces.js';
import type { WhereInput } from '../where.js';
import { AbstractOrgAppendDao } from './abstract-org-append.dao.js';

/** The full CRUD, scoped by organization. Most business tables land here. */
export abstract class AbstractOrgDao<TB extends keyof DB & string, E = string>
  extends AbstractOrgAppendDao<TB, E>
  implements IOrgDao<E, Model<TB>, New<TB>, Patch<TB>>
{
  update(orgId: OrgId, id: E, data: Patch<TB>, opts?: UpdateOpts): Promise<Model<TB>> {
    return this.flat.update(this.key(orgId, id), data, opts);
  }

  updateMany(orgId: OrgId, where: WhereInput<Model<TB>>, data: Patch<TB>): Promise<number> {
    return this.flat.updateMany(this.scoped(orgId, where), data);
  }

  upsert(orgId: OrgId, id: E, create: New<TB>, update: Patch<TB>): Promise<Model<TB>> {
    return this.flat.upsert(this.key(orgId, id), create, update);
  }

  delete(orgId: OrgId, id: E): Promise<Model<TB>> {
    return this.flat.delete(this.key(orgId, id));
  }

  deleteMany(orgId: OrgId, where: WhereInput<Model<TB>>): Promise<number> {
    return this.flat.deleteMany(this.scoped(orgId, where));
  }
}
