import { ok, type OrgId, type Result } from '@app/common';
import { Slug } from './ids.js';
import type { InvalidSlugError } from './errors.js';

export class Organization {
  private constructor(
    readonly id: OrgId,
    readonly name: string,
    readonly slug: Slug,
    readonly active: boolean,
    readonly version: number,
  ) {}

  static create(input: { id: OrgId; name: string; slug: string }): Result<Organization, InvalidSlugError> {
    const slug = Slug.of(input.slug);
    if (!slug.ok) return slug;
    return ok(new Organization(input.id, input.name.trim(), slug.value, true, 1));
  }

  /** Rehydration from persistence; no validation, the row already passed it. */
  static rehydrate(p: { id: OrgId; name: string; slug: Slug; active: boolean; version: number }): Organization {
    return new Organization(p.id, p.name, p.slug, p.active, p.version);
  }
}
