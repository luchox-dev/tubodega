import type { OrgId } from '@app/common';
import type { Slug } from '../../src/domain/ids.js';
import { SlugTakenError } from '../../src/domain/errors.js';
import type { Organization } from '../../src/domain/organization.js';
import type { OrganizationRepository } from '../../src/application/ports/organization.repository.js';

export class InMemoryOrganizationRepository implements OrganizationRepository {
  readonly rows = new Map<OrgId, Organization>();

  async findById(id: OrgId) {
    return this.rows.get(id) ?? null;
  }
  async findBySlug(slug: Slug) {
    return [...this.rows.values()].find((o) => o.slug === slug) ?? null;
  }
  async save(org: Organization) {
    for (const other of this.rows.values()) {
      if (other.id !== org.id && other.slug === org.slug) throw new SlugTakenError(org.slug);
    }
    this.rows.set(org.id, org);
  }
}
