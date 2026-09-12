import { Injectable } from '@nestjs/common';
import type { OrgId } from '@app/common';
import { SeedFactoryTemplates } from '@app/process';
import type { OrgSeeder } from '../tenancy/org-provisioner.adapter.js';

/**
 * Cross-module adapter (spec 07 §7): tenancy declares the need through
 * OrgSeeder, process satisfies it. Runs inside the transaction that creates the
 * organization, so an organization with half its templates cannot exist.
 *
 * The use case takes an OrgId and not a RequestContext on purpose: at this
 * point there is no token, no user and no organization to scope to (spec 07
 * §2, decision D-26).
 */
@Injectable()
export class FactoryTemplatesSeeder implements OrgSeeder {
  constructor(private readonly useCase: SeedFactoryTemplates) {}

  seed(orgId: OrgId): Promise<void> {
    return this.useCase.execute(orgId);
  }
}
