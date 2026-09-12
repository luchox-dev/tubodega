import { Injectable } from '@nestjs/common';
import type { OrgId } from '@app/common';
import { SeedBoundaryNodes } from '@app/inventory';
import type { OrgSeeder } from '../tenancy/org-provisioner.adapter.js';

/**
 * Cross-module adapter (spec 07 §7): tenancy declares the need through
 * OrgSeeder, inventory satisfies it. Runs inside the transaction that creates
 * the organization, so a half-seeded organization cannot exist (spec 04 §6).
 *
 * The use case takes an OrgId and not a RequestContext on purpose: at this
 * point there is no token, no user and no organization to scope to (spec 07
 * §2, decision D-26).
 */
@Injectable()
export class BoundaryNodesSeeder implements OrgSeeder {
  // Not named `seed`: that is the method of the interface.
  constructor(private readonly useCase: SeedBoundaryNodes) {}

  seed(orgId: OrgId): Promise<void> {
    return this.useCase.execute(orgId);
  }
}
