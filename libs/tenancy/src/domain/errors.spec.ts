import {
  AmbiguousLoginError,
  EmailTakenError,
  InsufficientRoleError,
  InvalidCredentialsError,
  InvalidEmailError,
  InvalidSlugError,
  LastOwnerError,
  SlugTakenError,
  TokenExpiredError,
} from './errors.js';

/** The `type`/`status` pairs are the public contract of spec 10 §9. */
describe('tenancy errors', () => {
  it.each([
    [new InvalidEmailError('x'), 'invalid-email', 422, '/email'],
    [new InvalidSlugError('x'), 'invalid-slug', 422, '/slug'],
    [new SlugTakenError('la-esquina'), 'slug-taken', 409, undefined],
    [new EmailTakenError('a@b.co'), 'email-taken', 409, undefined],
    [new InvalidCredentialsError(), 'invalid-credentials', 401, undefined],
    [new TokenExpiredError(), 'token-expired', 401, undefined],
    [new AmbiguousLoginError(), 'ambiguous-login', 409, undefined],
    [new InsufficientRoleError('MANAGE_USERS'), 'insufficient-role', 403, undefined],
    [new LastOwnerError(), 'last-owner', 422, undefined],
  ])('%s → %s %d', (error, type, status, pointer) => {
    expect(error.type).toBe(type);
    expect(error.status).toBe(status);
    expect(error.message.length).toBeGreaterThan(0);
    if (pointer) expect(error.errors?.[0]?.pointer).toBe(pointer);
  });

  it('detail names the offending value where it helps the user', () => {
    expect(new SlugTakenError('la-esquina').message).toContain('la-esquina');
    expect(new EmailTakenError('a@b.co').message).toContain('a@b.co');
    expect(new InsufficientRoleError('MANAGE_USERS').message).toContain('MANAGE_USERS');
  });
});
