import { Injectable } from '@nestjs/common';
import { sql } from 'kysely';
import { TransactionContext } from '../kysely/transaction.context.js';
import type { NewOrganization, OrganizationModel, OrganizationPatch } from '../models/index.js';
import { RecordNotFoundError, VersionConflictError, translatePgError } from './base/errors.js';

/**
 * `organization` is the root of isolation: no org_id, no RLS, no Org family.
 * Access is always by identifier resolved from the token (spec 10 §6).
 */
@Injectable()
export class OrganizationDao {
  constructor(private readonly ctx: TransactionContext) {}

  private get db() {
    return this.ctx.current();
  }

  async findById(id: string): Promise<OrganizationModel | null> {
    const row = await this.db.selectFrom('organization').selectAll().where('id', '=', id).executeTakeFirst();
    return row ?? null;
  }

  async findBySlug(slug: string): Promise<OrganizationModel | null> {
    const row = await this.db.selectFrom('organization').selectAll().where('slug', '=', slug).executeTakeFirst();
    return row ?? null;
  }

  async insert(data: NewOrganization): Promise<OrganizationModel> {
    try {
      return await this.db.insertInto('organization').values(data).returningAll().executeTakeFirstOrThrow();
    } catch (e) {
      translatePgError(e);
    }
  }

  async update(id: string, data: OrganizationPatch, expectedVersion: number): Promise<OrganizationModel> {
    const row = await this.db
      .updateTable('organization')
      .set({ ...data, version: sql`version + 1`, updatedAt: sql`now()` })
      .where('id', '=', id)
      .where('version', '=', expectedVersion)
      .returningAll()
      .executeTakeFirst();
    if (row) return row;
    if (!(await this.findById(id))) throw new RecordNotFoundError('organization', id);
    throw new VersionConflictError('organization', id);
  }
}
