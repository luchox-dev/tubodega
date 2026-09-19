import type { OrgId } from '@app/common';
import type { TemplateCode } from '../../domain/ids.js';
import type { ProcessTemplate } from '../../domain/template.js';

/** The five of spec 13 §8. */
export interface ProcessTemplateRepository {
  findActive(orgId: OrgId, code: TemplateCode): Promise<ProcessTemplate | null>;
  /**
   * El número de la versión en servicio, leído de la columna y sin construir la
   * plantilla. Publicar una versión nueva necesita saber a cuál tiene que
   * superar, y nada más: hacerlo con `findActive` ataba el único camino de
   * arreglo a que la plantilla rota se pudiera parsear, y una organización que
   * hubiera publicado una inválida se quedaba sin forma de salir.
   */
  activeVersion(orgId: OrgId, code: TemplateCode): Promise<number | null>;
  /** Si ese número ya está cogido. Tampoco hace falta construir nada. */
  versionExists(orgId: OrgId, code: TemplateCode, version: number): Promise<boolean>;
  /** Deja el código sin versión activa, antes de publicar la que la sustituye. */
  deactivateAll(orgId: OrgId, code: TemplateCode): Promise<void>;
  findVersion(orgId: OrgId, code: TemplateCode, version: number): Promise<ProcessTemplate | null>;
  listActive(orgId: OrgId): Promise<ProcessTemplate[]>;
  /**
   * P-9: a template with instances is not modified, it is versioned. Declared
   * with no route that produces it in the MVP — there is no template editing
   * yet — because the day there is, the rule has to already be reachable.
   */
  hasInstances(orgId: OrgId, code: TemplateCode, version: number): Promise<boolean>;
  save(template: ProcessTemplate): Promise<void>;
}

export const PROCESS_TEMPLATE_REPOSITORY = Symbol('ProcessTemplateRepository');
