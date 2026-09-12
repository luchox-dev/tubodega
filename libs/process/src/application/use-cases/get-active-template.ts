import { Inject, Injectable } from '@nestjs/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { TemplateNotFoundError } from '../../domain/errors.js';
import { TemplateCode } from '../../domain/ids.js';
import type { ProcessTemplate } from '../../domain/template.js';
import { PROCESS_TEMPLATE_REPOSITORY, type ProcessTemplateRepository } from '../ports/process-template.repository.js';

@Injectable()
export class GetActiveTemplate {
  constructor(
    @Inject(PROCESS_TEMPLATE_REPOSITORY) private readonly templates: ProcessTemplateRepository,
  ) {}

  /**
   * Takes the raw code from the path. A code that does not fit the column
   * cannot exist, so it is a 404 and not a 422: answering "your code is longer
   * than 64 characters" would be telling the client the width of a column.
   */
  async execute(ctx: RequestContext, raw: string): Promise<ProcessTemplate> {
    requireAction(ctx, Action.READ);

    const code = TemplateCode.of(raw);
    if (!code.ok) throw new TemplateNotFoundError(raw);

    const found = await this.templates.findActive(ctx.orgId, code.value);
    // Not there, or there with no active version: the same answer, because the
    // difference is not the client's business and neither is the organization
    // next door (I-6, never a 403).
    if (!found) throw new TemplateNotFoundError(raw);
    return found;
  }
}
