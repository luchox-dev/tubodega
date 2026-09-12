import { Inject, Injectable } from '@nestjs/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import type { CustomFieldDefinition } from '../../domain/custom-field.js';
import type { CustomType } from '../../domain/enums.js';
import {
  CustomFieldNotFoundError, CustomFieldTypeLockedError, RequiredFieldWouldInvalidateError,
} from '../../domain/errors.js';
import type { CustomFieldId } from '../../domain/ids.js';
import { CUSTOM_FIELD_REPOSITORY, type CustomFieldDefinitionRepository } from '../ports/custom-field.repository.js';

export interface UpdateCustomFieldInput {
  readonly id: CustomFieldId;
  readonly label?: string;
  readonly options?: readonly string[];
  readonly required?: boolean;
  readonly position?: number;
  /** Only accepted while nobody has a value yet (D-10). */
  readonly type?: CustomType;
  readonly expectedVersion: number;
}

@Injectable()
export class UpdateCustomField {
  constructor(@Inject(CUSTOM_FIELD_REPOSITORY) private readonly fields: CustomFieldDefinitionRepository) {}

  async execute(ctx: RequestContext, input: UpdateCustomFieldInput): Promise<CustomFieldDefinition> {
    requireAction(ctx, Action.MANAGE_CATALOG);
    const def = await this.fields.findById(ctx.orgId, input.id);
    if (!def) throw new CustomFieldNotFoundError();

    // D-10: changing the type of a field that already holds values would
    // reinterpret data nobody agreed to reinterpret.
    if (input.type !== undefined && input.type !== def.type) {
      const used = await this.fields.countEntitiesWith(ctx.orgId, def.entity, def.key);
      if (used > 0) throw new CustomFieldTypeLockedError(def.key, used);
    }

    // C-10 again: making an existing field required has the same consequence
    // as being born required.
    if (input.required === true && !def.required) {
      const missing = await this.fields.countEntitiesMissing(ctx.orgId, def.entity, def.key);
      if (missing > 0) throw new RequiredFieldWouldInvalidateError(def.key, missing);
    }

    const next = def.withMetadata(input);
    const version = await this.fields.save(next, input.expectedVersion);
    return next.withVersion(version);
  }
}
