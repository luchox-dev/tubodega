import { Inject, Injectable } from '@nestjs/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import type { ProcessTemplate } from '../../domain/template.js';
import { PROCESS_TEMPLATE_REPOSITORY, type ProcessTemplateRepository } from '../ports/process-template.repository.js';

/**
 * The processes this organization can run. Only the active versions: an old
 * version still exists — that is what versioning is for — but it is not a
 * process anybody should be starting.
 *
 * No cursor. They are six, and the day they are per tenant they will still be
 * few (spec 13 §6).
 */
@Injectable()
export class ListTemplates {
  constructor(
    @Inject(PROCESS_TEMPLATE_REPOSITORY) private readonly templates: ProcessTemplateRepository,
  ) {}

  // `async` and not a bare Promise return: `requireAction` throws, and from a
  // synchronous function it throws *before* there is a promise to reject —
  // which is a different thing for every caller that awaits it.
  async execute(ctx: RequestContext): Promise<ProcessTemplate[]> {
    requireAction(ctx, Action.READ);
    return this.templates.listActive(ctx.orgId);
  }
}
