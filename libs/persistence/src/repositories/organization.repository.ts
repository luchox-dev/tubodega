import { Injectable } from '@nestjs/common';
import type { OrgId } from '@app/common';
import {
  Organization,
  SlugTakenError,
  type OrganizationRepository,
  type Slug,
} from '@app/tenancy';
import { OrganizationDao } from '../dao/organization.dao.js';
import { RecordNotFoundError, UniqueViolationError } from '../dao/base/errors.js';
import type { OrganizationModel } from '../models/index.js';

const toOrganization = (row: OrganizationModel): Organization =>
  Organization.rehydrate({
    id: row.id as OrgId,
    name: row.name,
    slug: row.slug as Slug,
    active: row.active,
    version: row.version,
  });

@Injectable()
export class KyselyOrganizationRepository implements OrganizationRepository {
  constructor(private readonly dao: OrganizationDao) {}

  async findById(id: OrgId): Promise<Organization | null> {
    const row = await this.dao.findById(id);
    return row ? toOrganization(row) : null;
  }

  async findBySlug(slug: Slug): Promise<Organization | null> {
    const row = await this.dao.findBySlug(slug);
    return row ? toOrganization(row) : null;
  }

  async save(org: Organization): Promise<void> {
    const data = { name: org.name, slug: org.slug, active: org.active };
    try {
      await this.dao.update(org.id, data, org.version);
    } catch (e) {
      if (e instanceof RecordNotFoundError) {
        await this.dao.insert({ id: org.id, ...data }).catch(translate(org));
        return;
      }
      translate(org)(e);
    }
  }
}

const translate = (org: Organization) => (e: unknown): never => {
  if (e instanceof UniqueViolationError && e.constraint === 'organization_slug_key') {
    throw new SlugTakenError(org.slug);
  }
  throw e;
};
