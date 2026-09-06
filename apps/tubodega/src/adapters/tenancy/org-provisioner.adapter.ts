import { Inject, Injectable } from '@nestjs/common';
import type { OrgId } from '@app/common';
import type { OrgProvisioner } from '@app/tenancy';

/** One seeder per module: boundary nodes (inventory), factory templates (process), alert rules (alerts). */
export interface OrgSeeder {
  seed(orgId: OrgId): Promise<void>;
}
export const ORG_SEEDERS = Symbol('OrgSeeders');

/**
 * Cross-module adapter (spec 07 §7): tenancy declares the need, the modules
 * below satisfy it. Runs inside the transaction that creates the organization,
 * so a half-seeded organization cannot exist (spec 04 §6). Plans 4, 8 and 9
 * each add their seeder; today the list is empty (decision D-2).
 */
@Injectable()
export class CompositeOrgProvisioner implements OrgProvisioner {
  constructor(@Inject(ORG_SEEDERS) private readonly seeders: readonly OrgSeeder[]) {}

  async provision(orgId: OrgId): Promise<void> {
    for (const seeder of this.seeders) await seeder.seed(orgId);
  }
}
