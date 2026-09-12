// Row ↔ entity in both directions. The DAO knows nothing about ProcessTemplate
// (spec 08 §7).
import { unwrap, type OrgId } from '@app/common';
import { ProcessTemplate, type ProcessTemplateId } from '@app/process';
import type { ProcessTemplateModel } from '../../models/index.js';

/**
 * Through `create` and not a `rehydrate` twin, because `ProcessTemplate` has
 * none: `steps` is JSONB whose shape is going to change (spec 13 §9), the
 * validator is pure and cheap, and reading is the last chance to notice that
 * what got seeded cannot be run. A row that fails it is a bug of this
 * repository, never something an organization can cause, so it throws.
 */
export const toProcessTemplate = (row: ProcessTemplateModel): ProcessTemplate =>
  unwrap(
    ProcessTemplate.create({
      id: row.id as ProcessTemplateId,
      orgId: row.orgId as OrgId,
      code: row.code,
      version: row.version,
      steps: row.steps,
      active: row.active,
    }),
  );

export const processTemplateValues = (t: ProcessTemplate) => ({
  code: t.code as string,
  version: t.version,
  // jsonb goes in as a string, like every other jsonb column of the house.
  steps: JSON.stringify(t.steps),
  active: t.active,
});
