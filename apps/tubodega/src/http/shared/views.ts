import type { Page } from '@app/common';
import type { Organization, User } from '@app/tenancy';
import type { OrganizationView, UserView } from './shared.dto.js';

export const userView = (u: User): UserView => ({
  id: u.id,
  email: u.email,
  name: u.name,
  roles: [...u.roles],
  active: u.active,
});

export const organizationView = (o: Organization): OrganizationView => ({ id: o.id, name: o.name, slug: o.slug });

/** `{ data, page: { nextCursor, hasMore } }` — the envelope of spec 03 §6. */
export const pageView = <T, V>(page: Page<T>, view: (item: T) => V) => ({
  data: page.data.map(view),
  page: { nextCursor: page.nextCursor, hasMore: page.hasMore },
});
