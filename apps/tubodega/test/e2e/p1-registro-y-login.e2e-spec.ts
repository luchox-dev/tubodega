// Plan 1 · Marta registra «Distribuidora La Esquina», inicia sesión y consulta
// su perfil. Solo el contrato público (spec 06 §6).
import { randomBytes } from 'node:crypto';
import { v4 } from 'uuid';
import { startTestApp, type TestApp } from '../../../../test/support/e2e/app.js';
import { expectProblem } from '../../../../test/support/e2e/problem.js';
import { PASSWORD, expiredToken, login, registerOrg, type Tenant } from '../../../../test/support/e2e/tenant.js';

describe('Plan 1 · registro, login y /me', () => {
  let t: TestApp;
  let esquina: Tenant;
  const slug = `la-esquina-${randomBytes(4).toString('hex')}`;
  const email = `marta-${slug}@esquina.co`;

  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(() => t.stop());

  it('1 · Marta registra el negocio', async () => {
    const res = await t.http.post(
      '/v1/organizations',
      { name: 'Distribuidora La Esquina', slug, owner: { email: `Marta-${slug}@Esquina.co`, name: 'Marta', password: PASSWORD } },
      { idem: false },
    );
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/v1/organizations/${res.body.organization.id}`);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.organization).toMatchObject({ name: 'Distribuidora La Esquina', slug });
    expect(res.body.owner).toMatchObject({ email, name: 'Marta', roles: ['OWNER'], active: true });
    expect(res.body.owner.passwordHash).toBeUndefined();
    esquina = { slug, orgId: res.body.organization.id, owner: await login(t.http, email, PASSWORD) };
  });

  it('2 · el mismo slug otra vez → 409 slug-taken con problem+json completo', async () => {
    const res = await t.http.post(
      '/v1/organizations',
      { name: 'Otra', slug, owner: { email: 'x@y.co', name: 'X', password: PASSWORD } },
      { idem: false },
    );
    expectProblem(res, { status: 409, type: 'slug-taken' });
    expect(res.body.instance).toBe('/v1/organizations');
    expect(res.body.detail).toContain(slug);
  });

  it('3 · cuerpo inválido → 400 validation-failed con pointers', async () => {
    const res = await t.http.post('/v1/organizations', { name: 'X', slug: 'La Esquina', owner: { email: 'a@b.co', name: 'A' } }, { idem: false });
    expectProblem(res, { status: 400, type: 'validation-failed', pointer: '/owner/password' });
    const slugRes = await t.http.post(
      '/v1/organizations',
      { name: 'X', slug: 'La Esquina', owner: { email: 'a@b.co', name: 'A', password: PASSWORD } },
      { idem: false },
    );
    expectProblem(slugRes, { status: 422, type: 'invalid-slug', pointer: '/slug' });
  });

  it('4 · un orgId colado en el cuerpo se ignora (T-4)', async () => {
    const other = `otra-${randomBytes(4).toString('hex')}`;
    const res = await t.http.post(
      '/v1/organizations',
      { name: 'Otra', slug: other, orgId: esquina.orgId, owner: { email: `x-${other}@y.co`, name: 'X', password: PASSWORD } },
      { idem: false },
    );
    expect(res.status).toBe(201);
    expect(res.body.organization.id).not.toBe(esquina.orgId);
    expect(res.body.orgId).toBeUndefined();
  });

  it('5 · login correcto devuelve tokens y normaliza el correo', async () => {
    const res = await t.http.post('/v1/auth/login', { email: `MARTA-${slug}@ESQUINA.CO`, password: PASSWORD }, { idem: false });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ expiresIn: 900, user: { email, roles: ['OWNER'] } });
    expect(typeof res.body.accessToken).toBe('string');
    expect(typeof res.body.refreshToken).toBe('string');
  });

  it('6 · contraseña errónea y correo inexistente → 401 invalid-credentials, misma forma', async () => {
    const wrong = await t.http.post('/v1/auth/login', { email, password: 'nope-nope-nope' }, { idem: false });
    const unknown = await t.http.post('/v1/auth/login', { email: 'nadie@esquina.co', password: PASSWORD }, { idem: false });
    expectProblem(wrong, { status: 401, type: 'invalid-credentials' });
    expectProblem(unknown, { status: 401, type: 'invalid-credentials' });
    expect(wrong.body.detail).toBe(unknown.body.detail);
  });

  it('7 · /me con token devuelve usuario y organización', async () => {
    const res = await t.http.get('/v1/me', { token: esquina.owner.token });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: esquina.owner.userId, email, roles: ['OWNER'] });
    expect(res.body.organization).toMatchObject({ id: esquina.orgId, slug });
  });

  it('8 · /me sin token, con basura y con token vencido', async () => {
    expectProblem(await t.http.get('/v1/me'), { status: 401, type: 'invalid-credentials' });
    expectProblem(await t.http.get('/v1/me', { token: 'basura' }), { status: 401, type: 'invalid-credentials' });
    const expired = await expiredToken(esquina.owner, esquina.orgId);
    expectProblem(await t.http.get('/v1/me', { token: expired }), { status: 401, type: 'token-expired' });
  });

  it('9 · traza: X-Request-Id no UUID se sustituye; un UUID dado se respeta', async () => {
    const bad = await t.http.get('/v1/me', { token: esquina.owner.token, headers: { 'x-request-id': 'req-123' } });
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const given = v4();
    const good = await t.http.get('/v1/me', { token: esquina.owner.token, headers: { 'x-request-id': given } });
    expect(good.headers['x-request-id']).toBe(given);
  });

  it('10 · el mismo correo en dos empresas: ambiguous-login sin slug, resuelto con slug', async () => {
    const second = await registerOrg(t.http, { ownerEmail: email, name: 'Ferretería del Norte' });
    const ambiguous = await t.http.post('/v1/auth/login', { email, password: PASSWORD }, { idem: false });
    expectProblem(ambiguous, { status: 409, type: 'ambiguous-login' });
    const me = await t.http.get('/v1/me', { token: (await login(t.http, email, PASSWORD, second.slug)).token });
    expect(me.body.organization.slug).toBe(second.slug);
    const me1 = await t.http.get('/v1/me', { token: (await login(t.http, email, PASSWORD, slug)).token });
    expect(me1.body.organization.slug).toBe(slug);
  });

  it('11 · el contrato está publicado', async () => {
    const res = await t.http.get('/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/v1/organizations', '/v1/auth/login', '/v1/me']),
    );
    expect(res.body.components.schemas.ProblemDetailsView).toBeDefined();
    expect(res.body.paths['/v1/organizations'].post.responses['409']).toBeDefined();
  });

  it('12 · una ruta inexistente responde problem+json 404', async () => {
    expectProblem(await t.http.get('/v1/nope', { token: esquina.owner.token }), { status: 404, type: 'not-found' });
  });
});
