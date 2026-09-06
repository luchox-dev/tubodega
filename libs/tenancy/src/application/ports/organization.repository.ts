import type { OrgId } from '@app/common';
import type { Slug } from '../../domain/ids.js';
import type { Organization } from '../../domain/organization.js';

export interface OrganizationRepository {
  findById(id: OrgId): Promise<Organization | null>;
  findBySlug(slug: Slug): Promise<Organization | null>;
  /** Insert or update by id with optimistic locking on `version`. Throws SlugTakenError on a duplicate slug. */
  save(org: Organization): Promise<void>;
}
export const ORGANIZATION_REPOSITORY = Symbol('OrganizationRepository');
