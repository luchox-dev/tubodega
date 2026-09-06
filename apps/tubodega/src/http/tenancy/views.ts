import type { Organization, User } from '@app/tenancy';
import type { OrganizationView, UserView } from './dto.js';

export const userView = (u: User): UserView => ({
  id: u.id,
  email: u.email,
  name: u.name,
  roles: [...u.roles],
  active: u.active,
});

export const organizationView = (o: Organization): OrganizationView => ({ id: o.id, name: o.name, slug: o.slug });
