import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK, EVENT_PUBLISHER, ID_GENERATOR, unwrap,
  type Clock, type EventPublisher, type IdGenerator,
} from '@app/common';
import { Action, requireAction, type RequestContext } from '@app/tenancy';
import { CustomFieldDefinition } from '../../domain/custom-field.js';
import type { CustomEntity, CustomType } from '../../domain/enums.js';
import { RequiredFieldWouldInvalidateError } from '../../domain/errors.js';
import type { CustomFieldId } from '../../domain/ids.js';
import { catalogEvent } from '../events.js';
import { CUSTOM_FIELD_REPOSITORY, type CustomFieldDefinitionRepository } from '../ports/custom-field.repository.js';

export interface DefineCustomFieldInput {
  readonly entity: CustomEntity;
  readonly key: string;
  readonly label: string;
  readonly type: CustomType;
  readonly options?: readonly string[];
  readonly required?: boolean;
  readonly position?: number;
}

@Injectable()
export class DefineCustomField {
  constructor(
    @Inject(CUSTOM_FIELD_REPOSITORY) private readonly fields: CustomFieldDefinitionRepository,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(ctx: RequestContext, input: DefineCustomFieldInput): Promise<CustomFieldDefinition> {
    requireAction(ctx, Action.MANAGE_CATALOG);
    const def = unwrap(
      CustomFieldDefinition.create({ id: this.ids.next() as CustomFieldId, orgId: ctx.orgId, ...input }),
    );

    // C-10: the classic retroactive-required-field problem. A thousand products
    // do not become invalid overnight; a field is born optional and becomes
    // required once everyone has it.
    if (def.required) {
      const missing = await this.fields.countEntitiesMissing(ctx.orgId, def.entity, def.key);
      if (missing > 0) throw new RequiredFieldWouldInvalidateError(def.key, missing);
    }

    await this.fields.save(def);
    await this.events.publish([
      catalogEvent(this.ids, 'custom_field.defined', ctx.orgId, ctx.traceId, this.clock.now(), {
        customFieldId: def.id,
        entity: def.entity,
        key: def.key,
        type: def.type,
      }),
    ]);
    return def;
  }
}
