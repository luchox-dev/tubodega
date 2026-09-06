import type { OrgId } from '@app/common';
import type { Slug } from '../../src/domain/ids.js';
import { Organization } from '../../src/domain/organization.js';

let seq = 0;

export function anOrganization(overrides: Partial<Parameters<typeof Organization.rehydrate>[0]> = {}): Organization {
  seq += 1;
  return Organization.rehydrate({
    id: `00000000-0000-7000-8000-0000000000${String(seq).padStart(2, '0')}` as OrgId,
    name: `Org ${seq}`,
    slug: `org-${seq}` as Slug,
    active: true,
    version: 1,
    ...overrides,
  });
}
