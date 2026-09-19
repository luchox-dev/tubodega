import { Inject, Injectable } from '@nestjs/common';
import { ID_GENERATOR, type IdGenerator } from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { InvalidTemplateError, TemplateNotFoundError, TemplateVersionTakenError } from '../../domain/errors.js';
import { TemplateCode, type ProcessTemplateId } from '../../domain/ids.js';
import { ProcessTemplate } from '../../domain/template.js';
import { PROCESS_TEMPLATE_REPOSITORY, type ProcessTemplateRepository } from '../ports/process-template.repository.js';

export interface CreateTemplateVersionInput {
  readonly code: string;
  /** Proposed by the client (decision D-61). */
  readonly version: number;
  /** Raw, as it travels in JSON: `parseSteps` is what decides it is runnable. */
  readonly steps: unknown;
}

/**
 * P-9: a template is never modified in place, a next version is created and the
 * previous one is deactivated. Instances already running keep pointing at the
 * version they started with, and finish under the rules they were born with.
 *
 * All the validation is inherited from `ProcessTemplate.create` — which is
 * `parseSteps` — so `branching-not-supported` (P-8), `unknown-step-type` and
 * `invalid-template` arrive here without a line of new validation. That is the
 * point of having exported it.
 *
 * `template-has-instances` has no route that produces it: there is no editing,
 * only versioning (spec 13 §12). `hasInstances` stays on the port for the day
 * there is.
 */
@Injectable()
export class CreateTemplateVersion {
  constructor(
    @Inject(PROCESS_TEMPLATE_REPOSITORY) private readonly templates: ProcessTemplateRepository,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async execute(ctx: RequestContext, input: CreateTemplateVersionInput): Promise<ProcessTemplate> {
    requireAction(ctx, Action.MANAGE_CATALOG);

    const code = TemplateCode.of(input.code);
    if (!code.ok) throw new TemplateNotFoundError(input.code);

    // You version what you can see: the same 404 as
    // `GET /v1/process-templates/{code}`, and for the same reason.
    const active = await this.templates.findActive(ctx.orgId, code.value);
    if (!active) throw new TemplateNotFoundError(input.code);

    // **Before the "must beat the active one" check**, because when both are
    // true — reposting the version in service — "that number is taken" is the
    // specific answer and "it does not move forward" is the vague one.
    if (await this.templates.findVersion(ctx.orgId, code.value, input.version)) {
      throw new TemplateVersionTakenError(input.code, input.version);
    }

    if (!Number.isInteger(input.version) || input.version <= active.version) {
      // Not `template-version-taken`: the number may well be free. What it
      // cannot be is behind the one in service — activating that would be
      // going back, not versioning.
      throw new InvalidTemplateError(
        `la versión ${input.version} no supera a la activa (${active.version})`,
      );
    }

    const created = ProcessTemplate.create({
      id: this.ids.next() as ProcessTemplateId,
      orgId: ctx.orgId,
      code: input.code,
      version: input.version,
      steps: input.steps,
      active: true,
    });
    if (!created.ok) throw created.error;

    // Deactivate first: if the new one fails to save, the transaction of the
    // request takes both back, and this order means there is never an instant
    // with two active versions of one code visible to a concurrent reader.
    await this.templates.save(active.deactivated());
    await this.templates.save(created.value);

    return created.value;
  }
}
