import { Inject, Injectable } from '@nestjs/common';
import { ID_GENERATOR, unwrap, type IdGenerator, type OrgId } from '@app/common';
import { FACTORY_TEMPLATES } from '../../domain/factory-templates.js';
import { TemplateCode, type ProcessTemplateId } from '../../domain/ids.js';
import { ProcessTemplate } from '../../domain/template.js';
import { PROCESS_TEMPLATE_REPOSITORY, type ProcessTemplateRepository } from '../ports/process-template.repository.js';

/**
 * The six factory templates of spec 13 §6, seeded with the organization.
 *
 * No ctx and no requireAction, for the same reason as `SeedBoundaryNodes`: when
 * this runs there is no organization and no token (spec 07 §2, decision D-26),
 * and a context with invented roles would be an authorization that cannot fail.
 * It publishes nothing either — `organization.created` already tells the story,
 * and nobody "created" these six.
 *
 * Idempotent by reading first rather than leaning on ON CONFLICT: a 23505 would
 * abort the organization-creation transaction, which is exactly what the
 * idempotency is here to avoid.
 */
@Injectable()
export class SeedFactoryTemplates {
  constructor(
    @Inject(PROCESS_TEMPLATE_REPOSITORY) private readonly templates: ProcessTemplateRepository,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async execute(orgId: OrgId): Promise<void> {
    for (const factory of FACTORY_TEMPLATES) {
      const code = unwrap(TemplateCode.of(factory.code));
      if (await this.templates.findVersion(orgId, code, factory.version)) continue;

      // `unwrap` and not a Result: a factory template that does not validate is
      // a bug in this repository, not something an organization can cause — and
      // `factory-templates.spec.ts` crosses all six against the validator.
      await this.templates.save(
        unwrap(
          ProcessTemplate.create({
            id: this.ids.next() as ProcessTemplateId,
            orgId,
            code: factory.code,
            version: factory.version,
            steps: factory.steps,
          }),
        ),
      );
    }
  }
}
