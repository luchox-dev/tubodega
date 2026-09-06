import { Test } from '@nestjs/testing';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { v7 } from 'uuid';
import { validate } from '@app/common';
import { TenancyModule } from '@app/tenancy';
import { AdaptersModule } from '../../src/adapters/adapters.module.js';
import { configureApp } from '../../src/app.setup.js';
import { AuthGuard } from '../../src/http/auth/auth.guard.js';
import { IdentityInterceptor } from '../../src/http/identity/identity.interceptor.js';
import { OpenApiController, OpenApiDocument } from '../../src/http/openapi/openapi.js';
import { DomainErrorFilter } from '../../src/http/problem/domain-error.filter.js';
import { TransactionInterceptor } from '../../src/http/tx/transaction.interceptor.js';
import { AuthController } from '../../src/http/tenancy/auth.controller.js';
import { OrganizationsController } from '../../src/http/tenancy/organizations.controller.js';
import { createTestHttp, type TestHttp } from '../../../../test/support/e2e/http.js';
import { expectProblem } from '../../../../test/support/e2e/problem.js';
import { expiredToken, registerOrg, type Tenant } from '../../../../test/support/e2e/tenant.js';
import { createPersistenceHarness } from '../../../../test/support/db.js';
import { ProbeModule } from './probe.module.js';

/** The real pipeline (spec 07 §3) plus the probe controller. `order` lets one test register it wrong on purpose. */
async function boot(order: 'correct' | 'wrong' = 'correct') {
  const interceptors =
    order === 'correct' ? [TransactionInterceptor, IdentityInterceptor] : [IdentityInterceptor, TransactionInterceptor];
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, validate }), AdaptersModule, TenancyModule, ProbeModule],
    controllers: [OrganizationsController, AuthController, OpenApiController],
    providers: [
      OpenApiDocument,
      { provide: APP_GUARD, useClass: AuthGuard },
      ...interceptors.map((useClass) => ({ provide: APP_INTERCEPTOR, useClass })),
      { provide: APP_FILTER, useClass: DomainErrorFilter },
    ],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, http: createTestHttp(app) };
}

describe('request pipeline (spec 07 §3)', () => {
  let app: NestFastifyApplication;
  let http: TestHttp;
  let tenant: Tenant;

  beforeAll(async () => {
    ({ app, http } = await boot());
    tenant = await registerOrg(http);
  });
  afterAll(() => app.close());

  it('T-5 · a tenant request sees app.current_org = the org of the token, inside the transaction', async () => {
    const res = await http.get('/v1/_probe/org', { token: tenant.owner.token });
    expect(res.status).toBe(200);
    expect(res.body.org).toBe(tenant.orgId);
  });

  it('a @Public() route runs in the system pool with no organization', async () => {
    const res = await http.get('/v1/_probe/org-public');
    expect(res.status).toBe(200);
    expect(res.body.org === null || res.body.org === '').toBe(true);
  });

  it('GET opens READ ONLY: a write fails and surfaces as 500 internal without details', async () => {
    const res = await http.get('/v1/_probe/write-on-get', { token: tenant.owner.token });
    expectProblem(res, { status: 500, type: 'internal' });
    expect(JSON.stringify(res.body)).not.toContain('25006');
  });

  it('an unexpected exception is a 500 problem that hides internals', async () => {
    const res = await http.post('/v1/_probe/boom', {}, { token: tenant.owner.token });
    expectProblem(res, { status: 500, type: 'internal' });
    expect(res.body.detail).not.toContain('internals');
  });

  it('no token → 401 invalid-credentials; garbage → 401; expired → 401 token-expired', async () => {
    expectProblem(await http.get('/v1/_probe/org'), { status: 401, type: 'invalid-credentials' });
    expectProblem(await http.get('/v1/_probe/org', { token: 'garbage' }), { status: 401, type: 'invalid-credentials' });
    const expired = await expiredToken(tenant.owner, tenant.orgId);
    expectProblem(await http.get('/v1/_probe/org', { token: expired }), { status: 401, type: 'token-expired' });
  });

  it('X-Request-Id is replaced unless it is a UUID, and always echoed', async () => {
    const bad = await http.get('/v1/_probe/org-public', { headers: { 'x-request-id': 'req-123' } });
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(bad.headers['x-request-id']).not.toBe('req-123');
    const given = v7();
    const good = await http.get('/v1/_probe/org-public', { headers: { 'x-request-id': given } });
    expect(good.headers['x-request-id']).toBe(given);
  });

  it('T-6 · a deactivated user with a valid token is rejected on the next request', async () => {
    // Deactivation happens directly in the database: DELETE /v1/users arrives in plan 2.
    const h = await createPersistenceHarness();
    try {
      await h.uow.runAs({ pool: 'system' }, () =>
        h.ctx.current().updateTable('appUser').set({ active: false }).where('id', '=', tenant.owner.userId).execute(),
      );
      expectProblem(await http.get('/v1/_probe/org', { token: tenant.owner.token }), {
        status: 401,
        type: 'invalid-credentials',
      });
    } finally {
      await h.uow.runAs({ pool: 'system' }, () =>
        h.ctx.current().updateTable('appUser').set({ active: true }).where('id', '=', tenant.owner.userId).execute(),
      );
      await h.close();
    }
  });

  it('the interceptor order is not cosmetic: identity before transaction breaks every tenant request', async () => {
    const wrong = await boot('wrong');
    try {
      const res = await wrong.http.get('/v1/_probe/org', { token: tenant.owner.token });
      expectProblem(res, { status: 500, type: 'internal' });
    } finally {
      await wrong.app.close();
    }
  });
});
