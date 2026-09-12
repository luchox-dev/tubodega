import { err, ok, type Branded, type Result } from '@app/common';
import { InvalidTemplateCodeError } from './errors.js';

/**
 * A step's id inside its template: "origen", "item", "lote", "confirmar".
 *
 * Steps are addressed by id and not by index (spec 13 §2): an `order: 1, 2, 3`
 * has nowhere to point a branch, and reordering a template would renumber the
 * steps and break the history of the instances already in flight.
 */
export type StepId = Branded<string, 'StepId'>;

/** A row of `process_template`. The natural key is (org, code, version). */
export type ProcessTemplateId = Branded<string, 'ProcessTemplateId'>;

/** The business name of a process: RECEPCION, TRASLADO, AJUSTE_ENTRADA, ... */
export type TemplateCode = Branded<string, 'TemplateCode'>;

// `varchar(64)` in `process_template.code`, and a path segment of
// `GET /v1/process-templates/{code}` — so no slash, and no leading or trailing
// blank. Same shape as NodeCode, for the same two reasons.
const TEMPLATE_CODE_RE = /^[^/\s](?:[^/\n\r]{0,62}[^/\s])?$/;

export const TemplateCode = {
  of(raw: string): Result<TemplateCode, InvalidTemplateCodeError> {
    const value = raw.trim();
    return TEMPLATE_CODE_RE.test(value) ? ok(value as TemplateCode) : err(new InvalidTemplateCodeError(raw));
  },
};
