// WAVE 1 · «Abrir el negocio». Marta registra «Distribuidora La Esquina», da de
// alta al equipo, y el sistema demuestra sus garantías transversales. Solo el
// contrato público: ni una consulta a la base (spec 06 §6).
import { randomBytes } from 'node:crypto';
import { v4, v7 } from 'uuid';
import { startTestApp, type TestApp } from '../../../../test/support/e2e/app.js';
import { expectProblem } from '../../../../test/support/e2e/problem.js';
import {
  PASSWORD,
  expiredToken,
  login,
  makeTenant,
  registerOrg,
  type Session,
  type Tenant,
} from '../../../../test/support/e2e/tenant.js';

describe('WAVE 1 · abrir el negocio', () => {
  let t: TestApp;
  let esquina: Tenant;
  let diego: Session;
  let juan: Session;
  let sofia: Session;

  const slug = `la-esquina-${randomBytes(4).toString('hex')}`;
  const marta = `marta-${slug}@esquina.co`;

  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(() => t.stop());

  const userIdOf = async (session: Session) => (await t.http.get('/v1/me', { token: session.token })).body.user.id;

  it('1 · Marta registra el negocio', async () => {
    const res = await t.http.post(
      '/v1/organizations',
      {
        name: 'Distribuidora La Esquina',
        slug,
        owner: { email: `Marta-${slug}@Esquina.co`, name: 'Marta', password: PASSWORD },
      },
      { idem: false },
    );
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/v1/organizations/${res.body.organization.id}`);
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.organization).toMatchObject({ name: 'Distribuidora La Esquina', slug });
    expect(res.body.owner).toMatchObject({ email: marta, name: 'Marta', roles: ['OWNER'], active: true });
    expect(res.body.owner.passwordHash).toBeUndefined();

    // El mismo slug otra vez, y un cuerpo inválido.
    const taken = await t.http.post(
      '/v1/organizations',
      { name: 'Otra', slug, owner: { email: 'x@y.co', name: 'X', password: PASSWORD } },
      { idem: false },
    );
    expectProblem(taken, { status: 409, type: 'slug-taken' });
    expect(taken.body.instance).toBe('/v1/organizations');

    const invalid = await t.http.post(
      '/v1/organizations',
      { name: 'X', slug: 'La Esquina', owner: { email: 'a@b.co', name: 'A' } },
      { idem: false },
    );
    expectProblem(invalid, { status: 400, type: 'validation-failed', pointer: '/owner/password' });

    esquina = makeTenant(t.http, slug, res.body.organization.id, await login(t.http, marta, PASSWORD, slug));
  });

  it('2 · Marta inicia sesión y ve su perfil', async () => {
    const ok = await t.http.post('/v1/auth/login', { email: `MARTA-${slug}@ESQUINA.CO`, password: PASSWORD }, { idem: false });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ expiresIn: 900, user: { email: marta, roles: ['OWNER'] } });

    const me = await t.http.get('/v1/me', { token: esquina.owner.token });
    expect(me.body.user).toMatchObject({ email: marta, roles: ['OWNER'] });
    expect(me.body.organization).toMatchObject({ id: esquina.orgId, slug });

    const wrong = await t.http.post('/v1/auth/login', { email: marta, password: 'nope-nope-nope' }, { idem: false });
    const unknown = await t.http.post('/v1/auth/login', { email: 'nadie@esquina.co', password: PASSWORD }, { idem: false });
    expectProblem(wrong, { status: 401, type: 'invalid-credentials' });
    expectProblem(unknown, { status: 401, type: 'invalid-credentials' });
    expect(wrong.body.detail).toBe(unknown.body.detail);

    expectProblem(await t.http.get('/v1/me'), { status: 401, type: 'invalid-credentials' });
    expectProblem(await t.http.get('/v1/me', { token: 'firma-inventada' }), { status: 401, type: 'invalid-credentials' });
    const expired = await expiredToken(esquina.owner, esquina.orgId);
    expectProblem(await t.http.get('/v1/me', { token: expired }), { status: 401, type: 'token-expired' });
  });

  it('3 · Marta da de alta al equipo', async () => {
    // El primero, crudo, para afirmar la forma de la respuesta.
    const created = await t.http.post(
      '/v1/users',
      { email: `diego-${slug}@esquina.co`, name: 'diego', password: PASSWORD, roles: ['ADMIN'] },
      { token: esquina.owner.token },
    );
    expect(created.status).toBe(201);
    expect(created.headers.location).toBe(`/v1/users/${created.body.id}`);
    expect(created.body).toMatchObject({ name: 'diego', roles: ['ADMIN'], active: true });
    expect(created.body.passwordHash).toBeUndefined();
    diego = await login(t.http, `diego-${slug}@esquina.co`, PASSWORD, slug);

    juan = await esquina.user('OPERATOR', 'juan');
    sofia = await esquina.user('VIEWER', 'sofia');

    const operators = await t.http.get('/v1/users?role=OPERATOR', { token: esquina.owner.token });
    expect(operators.body.data.map((u: { name: string }) => u.name)).toEqual(['juan']);

    const all = await t.http.get('/v1/users?sort=name', { token: esquina.owner.token });
    expect(all.body.data.map((u: { name: string }) => u.name)).toEqual(['Marta', 'diego', 'juan', 'sofia']);
    expect(all.body.page).toEqual({ hasMore: false });

    expectProblem(await t.http.get('/v1/users?foo=1', { token: esquina.owner.token }), {
      status: 400,
      type: 'invalid-filter',
      pointer: '/foo',
    });

    const dup = await t.http.post(
      '/v1/users',
      { email: `juan-${slug}@esquina.co`, name: 'Otro Juan', password: PASSWORD, roles: ['VIEWER'] },
      { token: esquina.owner.token },
    );
    expectProblem(dup, { status: 409, type: 'email-taken' });
  });

  it('4 · Sofía (VIEWER) intenta administrar', async () => {
    const res = await t.http.post(
      '/v1/users',
      { email: `colado-${slug}@esquina.co`, name: 'Colado', password: PASSWORD, roles: ['OWNER'] },
      { token: sofia.token },
    );
    expectProblem(res, { status: 403, type: 'insufficient-role' });
  });

  it('5 · Diego cambia roles con control de versión', async () => {
    const juanId = await userIdOf(juan);
    const ok = await t.http.patch('/v1/users/' + juanId, { roles: ['OPERATOR', 'ADMIN'] }, { token: diego.token, ifMatch: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body.roles.sort()).toEqual(['ADMIN', 'OPERATOR']);

    const stale = await t.http.patch('/v1/users/' + juanId, { roles: ['VIEWER'] }, { token: diego.token, ifMatch: 1 });
    expectProblem(stale, { status: 409, type: 'stale-version' });

    const missing = await t.http.patch('/v1/users/' + juanId, { roles: ['VIEWER'] }, { token: diego.token } as never);
    expectProblem(missing, { status: 400, type: 'missing-if-match' });

    // Y se deshace, para que Juan siga siendo solo OPERATOR en el resto del relato.
    const back = await t.http.patch('/v1/users/' + juanId, { roles: ['OPERATOR'] }, { token: diego.token, ifMatch: 2 });
    expect(back.status).toBe(200);
  });

  it('6 · nadie puede dejar la empresa sin dueño', async () => {
    const martaId = await userIdOf(esquina.owner);
    expectProblem(await t.http.del('/v1/users/' + martaId, { token: diego.token }), {
      status: 422,
      type: 'last-owner',
    });
  });

  it('7 · se revoca el acceso de alguien, y surte efecto de inmediato (T-6)', async () => {
    const sofiaId = await userIdOf(sofia);
    expect((await t.http.del('/v1/users/' + sofiaId, { token: diego.token })).status).toBe(204);
    expectProblem(await t.http.get('/v1/me', { token: sofia.token }), { status: 401, type: 'invalid-credentials' });
    const gone = await t.http.get('/v1/users?active=false', { token: diego.token });
    expect(gone.body.data.map((u: { name: string }) => u.name)).toEqual(['sofia']);
  });

  it('8 · sesión larga: refresco y cierre', async () => {
    const rotated = await t.http.post('/v1/auth/refresh', { refreshToken: juan.refreshToken }, { idem: false });
    expect(rotated.status).toBe(200);
    expect(rotated.body.refreshToken).not.toBe(juan.refreshToken);

    const reused = await t.http.post('/v1/auth/refresh', { refreshToken: juan.refreshToken }, { idem: false });
    expectProblem(reused, { status: 401, type: 'refresh-token-invalid' });

    const out = await t.http.post('/v1/auth/logout', { refreshToken: rotated.body.refreshToken }, { token: rotated.body.accessToken, idem: false });
    expect(out.status).toBe(204);
    expectProblem(await t.http.post('/v1/auth/refresh', { refreshToken: rotated.body.refreshToken }, { idem: false }), {
      status: 401,
      type: 'refresh-token-invalid',
    });
  });

  it('8b · Juan cambia su contraseña', async () => {
    const fresh = await login(t.http, `juan-${slug}@esquina.co`, PASSWORD, slug);
    const nueva = 'unmejorsecreto9';

    expectProblem(
      await t.http.post('/v1/me/password', { current: 'no-es-esa-1', next: nueva }, { token: fresh.token }),
      { status: 401, type: 'invalid-credentials' },
    );
    expect((await t.http.post('/v1/me/password', { current: PASSWORD, next: nueva }, { token: fresh.token })).status).toBe(204);

    const withNew = await t.http.post('/v1/auth/login', { email: `juan-${slug}@esquina.co`, password: nueva, slug }, { idem: false });
    expect(withNew.status).toBe(200);
    expectProblem(
      await t.http.post('/v1/auth/login', { email: `juan-${slug}@esquina.co`, password: PASSWORD, slug }, { idem: false }),
      { status: 401, type: 'invalid-credentials' },
    );
    juan = { ...juan, token: withNew.body.accessToken, refreshToken: withNew.body.refreshToken };
  });

  it('9 · otra empresa no ve nada: 404 y nunca 403 (I-6)', async () => {
    const juanId = await userIdOf(juan);
    // T-1 es por organización: el mismo correo de Marta es válido en otra
    // empresa. Se usa el suyo y no el de Juan porque en 8b Juan cambió su
    // contraseña, y la ambigüedad de 9b exige que la contraseña valga en ambas.
    const norte = await registerOrg(t.http, { ownerEmail: marta, name: 'Ferretería del Norte' });

    expectProblem(await t.http.get('/v1/users/' + juanId, { token: norte.owner.token }), {
      status: 404,
      type: 'not-found',
    });
    expectProblem(
      await t.http.patch('/v1/users/' + juanId, { roles: ['VIEWER'] }, { token: norte.owner.token, ifMatch: 1 }),
      { status: 404, type: 'not-found' },
    );
    expectProblem(await t.http.del('/v1/users/' + juanId, { token: norte.owner.token }), {
      status: 404,
      type: 'not-found',
    });
    // Y su listado no incluye a nadie de La Esquina.
    const theirs = await t.http.get('/v1/users', { token: norte.owner.token });
    expect(theirs.body.data).toHaveLength(1);

    // 9b · el correo en dos empresas exige slug.
    expectProblem(await t.http.post('/v1/auth/login', { email: marta, password: PASSWORD }, { idem: false }), {
      status: 409,
      type: 'ambiguous-login',
    });
    const there = await login(t.http, marta, PASSWORD, norte.slug);
    expect((await t.http.get('/v1/me', { token: there.token })).body.organization.slug).toBe(norte.slug);
    const here = await login(t.http, marta, PASSWORD, slug);
    expect((await t.http.get('/v1/me', { token: here.token })).body.organization.slug).toBe(slug);
  });

  it('10 · nadie elige su organización (T-4)', async () => {
    const other = await registerOrg(t.http);
    const created = await t.http.post(
      '/v1/users',
      { email: `colado-${slug}@esquina.co`, name: 'Colado', password: PASSWORD, roles: ['VIEWER'], orgId: other.orgId },
      { token: esquina.owner.token },
    );
    expect(created.status).toBe(201);

    // Se creó aquí, no allí: el campo del cuerpo se descartó en silencio.
    expect((await t.http.get('/v1/users/' + created.body.id, { token: esquina.owner.token })).status).toBe(200);
    expect((await t.http.get('/v1/users/' + created.body.id, { token: other.owner.token })).status).toBe(404);
    expect((await t.http.get('/v1/users', { token: other.owner.token })).body.data).toHaveLength(1);

    expectProblem(await t.http.get(`/v1/users?orgId=${other.orgId}`, { token: esquina.owner.token }), {
      status: 400,
      type: 'invalid-filter',
      pointer: '/orgId',
    });
  });

  it('11 · reintentos seguros (I-7)', async () => {
    const key = v7();
    const body = { email: `retry-${slug}@esquina.co`, name: 'Retry', password: PASSWORD, roles: ['VIEWER'] };

    const first = await t.http.post('/v1/users', body, { token: esquina.owner.token, idem: key });
    expect(first.status).toBe(201);
    const replay = await t.http.post('/v1/users', body, { token: esquina.owner.token, idem: key });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.headers['idempotency-replayed']).toBe('true');

    const listed = await t.http.get('/v1/users?limit=200', { token: esquina.owner.token });
    expect(listed.body.data.filter((u: { name: string }) => u.name === 'Retry')).toHaveLength(1);

    expectProblem(
      await t.http.post('/v1/users', { ...body, name: 'Otro' }, { token: esquina.owner.token, idem: key }),
      { status: 409, type: 'idempotency-key-reuse' },
    );
    expectProblem(await t.http.post('/v1/users', body, { token: esquina.owner.token, idem: false }), {
      status: 400,
      type: 'missing-idempotency-key',
    });
  });

  it('12 · trazabilidad', async () => {
    const replaced = await t.http.get('/v1/me', { token: esquina.owner.token, headers: { 'x-request-id': 'req-123' } });
    expect(replaced.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(replaced.headers['x-request-id']).not.toBe('req-123');

    const given = v4();
    const kept = await t.http.get('/v1/me', { token: esquina.owner.token, headers: { 'x-request-id': given } });
    expect(kept.headers['x-request-id']).toBe(given);

    const failed = await t.http.get('/v1/users?foo=1', { token: esquina.owner.token, headers: { 'x-request-id': given } });
    expect(failed.body.traceId).toBe(given);
  });

  it('13 · el contrato está publicado', async () => {
    const res = await t.http.get('/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.paths)).toEqual(
      expect.arrayContaining(['/v1/organizations', '/v1/auth/login', '/v1/auth/refresh', '/v1/users', '/v1/me/password']),
    );
    expect(res.body.paths['/v1/users'].post.responses['409']).toBeDefined();

    // Y una ruta que no existe sigue el mismo contrato de error.
    expectProblem(await t.http.get('/v1/nope', { token: esquina.owner.token }), { status: 404, type: 'not-found' });
  });
});
