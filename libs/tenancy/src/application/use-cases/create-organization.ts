import { Inject, Injectable } from '@nestjs/common';
import {
  CLOCK,
  EVENT_PUBLISHER,
  ID_GENERATOR,
  unwrap,
  type Clock,
  type EventPublisher,
  type IdGenerator,
  type OrgId,
  type TraceId,
  type UserId,
} from '@app/common';
import { SlugTakenError } from '../../domain/errors.js';
import { Slug } from '../../domain/ids.js';
import { Organization } from '../../domain/organization.js';
import { Role } from '../../domain/role.js';
import { User } from '../../domain/user.js';
import { tenancyEvent } from '../events.js';
import { ORG_PROVISIONER, type OrgProvisioner } from '../ports/org-provisioner.js';
import { ORGANIZATION_REPOSITORY, type OrganizationRepository } from '../ports/organization.repository.js';
import { PASSWORD_HASHER, type PasswordHasher } from '../ports/password-hasher.js';
import { USER_REPOSITORY, type UserRepository } from '../ports/user.repository.js';

export interface CreateOrganizationInput {
  readonly name: string;
  readonly slug: string;
  readonly owner: { readonly email: string; readonly name: string; readonly password: string };
}

/**
 * Registers a tenant with its first OWNER and everything the organization
 * needs to operate (via OrgProvisioner), in the transaction the edge opened.
 * Runs in system context: there is no organization to scope to yet (spec 10 §4).
 */
@Injectable()
export class CreateOrganization {
  constructor(
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(ORG_PROVISIONER) private readonly provisioner: OrgProvisioner,
    @Inject(EVENT_PUBLISHER) private readonly events: EventPublisher,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  async execute(
    input: CreateOrganizationInput,
    traceId: TraceId,
  ): Promise<{ organization: Organization; owner: User }> {
    const slug = unwrap(Slug.of(input.slug));
    if (await this.organizations.findBySlug(slug)) throw new SlugTakenError(slug);

    const organization = unwrap(
      Organization.create({ id: this.ids.next() as OrgId, name: input.name, slug }),
    );
    const owner = unwrap(
      User.create({
        id: this.ids.next() as UserId,
        orgId: organization.id,
        email: input.owner.email,
        name: input.owner.name,
        passwordHash: await this.hasher.hash(input.owner.password),
        roles: [Role.OWNER],
      }),
    );

    await this.organizations.save(organization);
    const ownerVersion = await this.users.save(owner);
    await this.provisioner.provision(organization.id);

    await this.events.publish([
      tenancyEvent(this.ids, 'organization.created', organization.id, traceId, this.clock.now(), {
        organizationId: organization.id,
        slug: organization.slug,
        ownerId: owner.id,
      }),
    ]);
    return { organization, owner: owner.withVersion(ownerVersion) };
  }
}
