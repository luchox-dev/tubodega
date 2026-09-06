import type { TraceId } from '@app/common';
import { Role } from '../../domain/role.js';
import { InvalidEmailError, InvalidSlugError, SlugTakenError } from '../../domain/errors.js';
import { CreateOrganization } from './create-organization.js';
import { InMemoryOrganizationRepository } from '../../../test/doubles/in-memory-organization.repository.js';
import { InMemoryUserRepository } from '../../../test/doubles/in-memory-user.repository.js';
import {
  FakePasswordHasher,
  FixedClock,
  InMemoryEventPublisher,
  RecordingOrgProvisioner,
  SequentialIdGenerator,
} from '../../../test/doubles/fakes.js';

const TRACE = '00000000-0000-7000-8000-0000000000ff' as TraceId;

function setup() {
  const organizations = new InMemoryOrganizationRepository();
  const users = new InMemoryUserRepository();
  const events = new InMemoryEventPublisher();
  const provisioner = new RecordingOrgProvisioner(events.log);
  const uc = new CreateOrganization(
    organizations,
    users,
    new FakePasswordHasher(),
    provisioner,
    events,
    new FixedClock(new Date('2026-09-06T10:00:00Z')),
    new SequentialIdGenerator(),
  );
  return { uc, organizations, users, events, provisioner };
}

const input = {
  name: 'Distribuidora La Esquina',
  slug: 'la-esquina',
  owner: { email: 'Marta@Esquina.co', name: 'Marta', password: 'correcthorse1' },
};

describe('CreateOrganization', () => {
  it('creates the organization and its OWNER with a hashed password', async () => {
    const { uc, organizations, users } = setup();
    const { organization, owner } = await uc.execute(input, TRACE);
    expect(organization.slug).toBe('la-esquina');
    expect(owner.orgId).toBe(organization.id);
    expect(owner.email).toBe('marta@esquina.co');
    expect(owner.roles).toEqual(new Set([Role.OWNER]));
    expect(owner.passwordHash).toBe('hashed:correcthorse1');
    expect(organizations.rows.size).toBe(1);
    expect(users.rows.size).toBe(1);
  });

  it('provisions the organization before publishing organization.created', async () => {
    const { uc, events, provisioner } = setup();
    const { organization } = await uc.execute(input, TRACE);
    expect(provisioner.calls).toEqual([organization.id]);
    expect(events.log).toEqual([`provision:${organization.id}`, 'event:organization.created']);
    expect(events.published[0]).toMatchObject({
      type: 'organization.created',
      orgId: organization.id,
      traceId: TRACE,
      occurredAt: new Date('2026-09-06T10:00:00Z'),
      data: { organizationId: organization.id, slug: 'la-esquina' },
    });
  });

  it('rejects a taken slug', async () => {
    const { uc } = setup();
    await uc.execute(input, TRACE);
    await expect(uc.execute({ ...input, owner: { ...input.owner, email: 'other@x.co' } }, TRACE)).rejects.toBeInstanceOf(
      SlugTakenError,
    );
  });

  it('rejects an invalid slug and an invalid email without touching repositories', async () => {
    const { uc, organizations } = setup();
    await expect(uc.execute({ ...input, slug: 'La Esquina' }, TRACE)).rejects.toBeInstanceOf(InvalidSlugError);
    await expect(uc.execute({ ...input, owner: { ...input.owner, email: 'nope' } }, TRACE)).rejects.toBeInstanceOf(
      InvalidEmailError,
    );
    expect(organizations.rows.size).toBe(0);
  });
});
