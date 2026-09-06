import type { OrgId } from '@app/common';

/**
 * Implemented outside tenancy (apps/tubodega/src/adapters): seeds boundary
 * nodes, factory templates and alert rules in the same transaction that
 * creates the organization (spec 10 §5, 04 §6). Keeps tenancy from depending
 * on inventory, process and alerts (R-2).
 */
export interface OrgProvisioner {
  provision(orgId: OrgId): Promise<void>;
}
export const ORG_PROVISIONER = Symbol('OrgProvisioner');
