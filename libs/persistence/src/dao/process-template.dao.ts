import { Injectable } from '@nestjs/common';
import type { OrgId } from '@app/common';
import { TransactionContext } from '../kysely/transaction.context.js';
import { AbstractOrgDao } from './base/org/abstract-org.dao.js';

@Injectable()
export class ProcessTemplateDao extends AbstractOrgDao<'processTemplate', string> {
  protected readonly table = 'processTemplate' as const;
  /**
   * **`versioned` stays false, and the column named `version` is the trap.**
   * It is not optimistic locking here: it is part of the natural key
   * `(org_id, code, version)` (spec 04 §3.6). With `versioned = true` — as
   * `NodeDao` has it, because there it really is a lock — every `update` would
   * do `version + 1` and `updated_at = now()`, which would both corrupt the
   * natural key and fail: this table has no `updated_at` column at all.
   */
  protected override readonly versioned = false;

  constructor(ctx: TransactionContext) {
    super(ctx);
  }

  /**
   * El número de la versión en servicio, sin construir la plantilla. Publicar
   * una versión nueva solo necesita saber a cuál superar, y cargarla entera
   * ataba ese camino a que la activa se pudiera parsear: una organización que
   * hubiera publicado una plantilla inválida se quedaba sin salida.
   */
  activeVersion(orgId: OrgId, code: string): Promise<number | null> {
    return this.db
      .selectFrom('processTemplate')
      .select('version')
      .where('orgId', '=', orgId)
      .where('code', '=', code)
      .where('active', '=', true)
      .executeTakeFirst()
      .then((row) => row?.version ?? null);
  }

  /** Si ese número ya está cogido para el código, sin construir nada. */
  versionExists(orgId: OrgId, code: string, version: number): Promise<boolean> {
    return this.db
      .selectFrom('processTemplate')
      .select('id')
      .where('orgId', '=', orgId)
      .where('code', '=', code)
      .where('version', '=', version)
      .limit(1)
      .executeTakeFirst()
      .then((row) => row !== undefined);
  }

  /** Deja el código sin versión activa, por la columna y no por la entidad. */
  async deactivateAll(orgId: OrgId, code: string): Promise<void> {
    await this.db
      .updateTable('processTemplate')
      .set({ active: false })
      .where('orgId', '=', orgId)
      .where('code', '=', code)
      .where('active', '=', true)
      .execute();
  }

  /**
   * P-9, asked of the template and answered by the instances. A concrete method
   * here and not a second DAO because plan 7 does not otherwise touch
   * `process_instance`; plan 8, which writes that table, brings its own.
   */
  hasInstances(orgId: OrgId, code: string, version: number): Promise<boolean> {
    return this.db
      .selectFrom('processInstance')
      .select('id')
      .where('orgId', '=', orgId)
      .where('templateCode', '=', code)
      .where('templateVersion', '=', version)
      .limit(1)
      .executeTakeFirst()
      .then((row) => row !== undefined);
  }
}
