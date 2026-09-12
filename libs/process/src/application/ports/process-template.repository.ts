import type { OrgId } from '@app/common';
import type { TemplateCode } from '../../domain/ids.js';
import type { ProcessTemplate } from '../../domain/template.js';

/** The five of spec 13 §8. */
export interface ProcessTemplateRepository {
  findActive(orgId: OrgId, code: TemplateCode): Promise<ProcessTemplate | null>;
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
