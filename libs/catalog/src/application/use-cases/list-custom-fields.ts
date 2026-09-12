import { Inject, Injectable } from '@nestjs/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import type { CustomFieldDefinition } from '../../domain/custom-field.js';
import type { CustomEntity } from '../../domain/enums.js';
import { CUSTOM_FIELD_REPOSITORY, type CustomFieldDefinitionRepository } from '../ports/custom-field.repository.js';

@Injectable()
export class ListCustomFields {
  constructor(@Inject(CUSTOM_FIELD_REPOSITORY) private readonly fields: CustomFieldDefinitionRepository) {}

  async execute(ctx: RequestContext, entity: CustomEntity): Promise<CustomFieldDefinition[]> {
    requireAction(ctx, Action.READ);
    return this.fields.listByEntity(ctx.orgId, entity);
  }
}
