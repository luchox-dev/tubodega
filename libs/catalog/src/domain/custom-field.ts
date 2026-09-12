import { err, ok, type OrgId, type ProblemFieldError, type Result } from '@app/common';
import { CustomEntity, CustomType } from './enums.js';
import { InvalidCustomFieldError } from './errors.js';
import { FieldKey, type CustomFieldId } from './ids.js';

export type CustomFieldValue = string | number | Date | boolean;

/** What a validated set of values looks like on the wire and in the jsonb column. */
export type CustomFieldsJson = Readonly<Record<string, string | number | boolean>>;

export class CustomFieldDefinition {
  private constructor(
    readonly id: CustomFieldId,
    readonly orgId: OrgId,
    readonly entity: CustomEntity,
    readonly key: FieldKey,
    readonly label: string,
    readonly type: CustomType,
    readonly options: readonly string[] | undefined,
    readonly required: boolean,
    readonly position: number,
    readonly version: number,
  ) {}

  static create(input: {
    id: CustomFieldId;
    orgId: OrgId;
    entity: CustomEntity;
    key: string;
    label: string;
    type: CustomType;
    options?: readonly string[];
    required?: boolean;
    position?: number;
  }): Result<CustomFieldDefinition> {
    const key = FieldKey.of(input.key);
    if (!key.ok) return key;
    if (input.type === CustomType.SELECT && (input.options?.length ?? 0) === 0) {
      return err(
        new InvalidCustomFieldError([{ pointer: '/options', code: 'options-required' }]),
      );
    }
    return ok(
      new CustomFieldDefinition(
        input.id,
        input.orgId,
        input.entity,
        key.value,
        input.label.trim(),
        input.type,
        input.type === CustomType.SELECT ? [...(input.options ?? [])] : undefined,
        input.required ?? false,
        input.position ?? 0,
        1,
      ),
    );
  }

  static rehydrate(p: {
    id: CustomFieldId;
    orgId: OrgId;
    entity: CustomEntity;
    key: FieldKey;
    label: string;
    type: CustomType;
    options?: readonly string[];
    required: boolean;
    position: number;
    version: number;
  }): CustomFieldDefinition {
    return new CustomFieldDefinition(
      p.id,
      p.orgId,
      p.entity,
      p.key,
      p.label,
      p.type,
      p.options,
      p.required,
      p.position,
      p.version,
    );
  }

  /**
   * The version the row ended up with. The entity deliberately does not bump it
   * — the repository is the only writer that knows — but what comes back from a
   * write has to carry the new one, or a client that PATCHes twice using the
   * version it was just handed gets a spurious 409 (decision D-31).
   */
  withVersion(version: number): CustomFieldDefinition {
    return new CustomFieldDefinition(
      this.id,
      this.orgId,
      this.entity,
      this.key,
      this.label,
      this.type,
      this.options,
      this.required,
      this.position,
      version,
    );
  }

  /** The type never changes here: that is a use-case decision (D-10), because
   *  only it can count the entities that already hold a value. */
  withMetadata(patch: {
    label?: string;
    options?: readonly string[];
    required?: boolean;
    position?: number;
  }): CustomFieldDefinition {
    return new CustomFieldDefinition(
      this.id,
      this.orgId,
      this.entity,
      this.key,
      patch.label?.trim() ?? this.label,
      this.type,
      this.type === CustomType.SELECT ? [...(patch.options ?? this.options ?? [])] : undefined,
      patch.required ?? this.required,
      patch.position ?? this.position,
      this.version,
    );
  }

  /**
   * A number arrives as a number and a date as a string, and that asymmetry is
   * deliberate: JSON has numbers, so `"12"` is a client bug worth reporting,
   * but JSON has no date type, so an ISO string is the only way to send one.
   */
  validate(value: unknown): Result<CustomFieldValue, InvalidCustomFieldError> {
    const bad = (code: string) =>
      err(new InvalidCustomFieldError([{ pointer: `/customFields/${this.key}`, code }]));

    switch (this.type) {
      case CustomType.TEXT:
        return typeof value === 'string' ? ok(value) : bad('expected-text');
      case CustomType.NUMBER:
        return typeof value === 'number' && Number.isFinite(value) ? ok(value) : bad('expected-number');
      case CustomType.BOOLEAN:
        return typeof value === 'boolean' ? ok(value) : bad('expected-boolean');
      case CustomType.DATE: {
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? bad('expected-date') : ok(value);
        if (typeof value !== 'string') return bad('expected-date');
        const at = new Date(value);
        return Number.isNaN(at.getTime()) ? bad('expected-date') : ok(at);
      }
      case CustomType.SELECT:
        return typeof value === 'string' && (this.options ?? []).includes(value)
          ? ok(value)
          : bad('not-an-option');
    }
  }
}

/**
 * C-7. The only way to hold custom values is to have gone through the
 * definitions, and that is checked by the type, not by a code review: no
 * constructor, no setter, no way in except `build`. It is what keeps the jsonb
 * column from becoming a sack where anything fits (spec 11 §2).
 */
export class CustomFieldValues {
  private constructor(private readonly values: ReadonlyMap<string, CustomFieldValue>) {}

  static empty(): CustomFieldValues {
    return new CustomFieldValues(new Map());
  }

  static build(
    defs: readonly CustomFieldDefinition[],
    raw: Readonly<Record<string, unknown>> = {},
  ): Result<CustomFieldValues, InvalidCustomFieldError> {
    const errors: ProblemFieldError[] = [];
    const out = new Map<string, CustomFieldValue>();
    const known = new Set(defs.map((d) => d.key as string));

    for (const key of Object.keys(raw)) {
      if (!known.has(key)) errors.push({ pointer: `/customFields/${key}`, code: 'unknown-field' });
    }

    for (const def of defs) {
      const given = raw[def.key];
      if (given === undefined || given === null) {
        if (def.required) {
          errors.push({ pointer: `/customFields/${def.key}`, code: 'required' });
        }
        continue;
      }
      const checked = def.validate(given);
      if (checked.ok) out.set(def.key, checked.value);
      else errors.push(...checked.error.errors);
    }

    return errors.length > 0 ? err(new InvalidCustomFieldError(errors)) : ok(new CustomFieldValues(out));
  }

  /** Rehydration from a jsonb column: the row already passed `build`. */
  static rehydrate(raw: Readonly<Record<string, unknown>> | null | undefined): CustomFieldValues {
    return new CustomFieldValues(new Map(Object.entries(raw ?? {}) as [string, CustomFieldValue][]));
  }

  get(key: FieldKey): CustomFieldValue | undefined {
    return this.values.get(key);
  }

  get size(): number {
    return this.values.size;
  }

  toJSON(): CustomFieldsJson {
    const out: Record<string, string | number | boolean> = {};
    for (const [k, v] of this.values) out[k] = v instanceof Date ? v.toISOString() : v;
    return out;
  }
}
