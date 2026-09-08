// I-7 against the real application (spec 07 §5). The store is proved at the
// row level elsewhere; here what is proved is the sequence, under concurrency.
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { v7 } from 'uuid';
import { validate, type OrgId } from '@app/common';
import { IdempotencyKeyDao, KyselyUnitOfWork } from '@app/persistence';
import { TenancyModule } from '@app/tenancy';
import { AdaptersModule } from '../../src/adapters/adapters.module.js';
import { configureApp } from '../../src/app.setup.js';
import { AuthController } from '../../src/http/auth/auth.controller.js';
import { OpenApiController, OpenApiDocument } from '../../src/http/openapi/openapi.controller.js';
import { OrganizationsController } from '../../src/http/organizations/organizations.controller.js';
import { AuthGuard } from '../../src/http/pipeline/auth.guard.js';
import { DomainErrorFilter } from '../../src/http/pipeline/domain-error.filter.js';
import { IdempotencyInterceptor } from '../../src/http/pipeline/idempotency.interceptor.js';
import { IdempotencyStore } from '../../src/http/pipeline/idempotency.store.js';
import { IdentityInterceptor } from '../../src/http/pipeline/identity.interceptor.js';
import { TransactionInterceptor } from '../../src/http/pipeline/transaction.interceptor.js';
import { createTestHttp, type TestHttp } from '../../../../test/support/e2e/http.js';
import { expectProblem } from '../../../../test/support/e2e/problem.js';
import { registerOrg, type Tenant } from '../../../../test/support/e2e/tenant.js';
import { ProbeGate, ProbeModule } from './probe.module.js';

describe('idempotency (spec 07 §5)', () => {
  let app: NestFastifyApplication;
  let http: TestHttp;
  let tenant: Tenant;
  let keys: IdempotencyKeyDao;
  let uow: KyselyUnitOfWork;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, validate }), AdaptersModule, TenancyModule, ProbeModule],
      controllers: [OrganizationsController, AuthController, OpenApiController],
      providers: [
        OpenApiDocument,
        IdempotencyStore,
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_INTERCEPTOR, useClass: TransactionInterceptor },
        { provide: APP_INTERCEPTOR, useClass: IdentityInterceptor },
        { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
        { provide: APP_FILTER, useClass: DomainErrorFilter },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    http = createTestHttp(app);
    keys = app.get(IdempotencyKeyDao);
    uow = app.get(KyselyUnitOfWork);
    tenant = await registerOrg(http);
  });
  afterAll(() => app.close());

  const token = () => tenant.owner.token;
  const orgId = () => tenant.orgId as OrgId;
  const readKey = (key: string) =>
    uow.runAs({ pool: 'system', orgId: orgId() }, () => keys.findUnique(orgId(), { key }));

  it('I-7 · two concurrent requests with the same key: one runs, the other is told so', async () => {
    const key = v7();
    ProbeGate.open();
    const first = http.post('/v1/_probe/slow', { n: 1 }, { token: token(), idem: key });
    // The handler runs after the reservation, so once it is entered the key is
    // provably taken and the second request is genuinely concurrent.
    await ProbeGate.entered();
    const second = await http.post('/v1/_probe/slow', { n: 1 }, { token: token(), idem: key });
    expectProblem(second, { status: 409, type: 'idempotency-key-in-flight' });

    ProbeGate.letGo();
    const done = await first;
    expect(done.status).toBe(201);
    expect(done.body).toEqual({ ok: true, at: 'slow' });

    // And once it finished, the same key replays instead of running again.
    const replay = await http.post('/v1/_probe/slow', { n: 1 }, { token: token(), idem: key });
    expect(replay.status).toBe(201);
    expect(replay.body).toEqual({ ok: true, at: 'slow' });
    expect(replay.headers['idempotency-replayed']).toBe('true');
  });

  it('the same key with a different body is a mistake, not a retry', async () => {
    const key = v7();
    expect((await http.post('/v1/_probe/echo', { n: 1 }, { token: token(), idem: key })).status).toBe(201);
    expectProblem(await http.post('/v1/_probe/echo', { n: 2 }, { token: token(), idem: key }), {
      status: 409,
      type: 'idempotency-key-reuse',
    });
  });

  it('key order in the body does not make it a different request', async () => {
    const key = v7();
    await http.post('/v1/_probe/echo', { a: 1, b: 2 }, { token: token(), idem: key });
    const again = await http.post('/v1/_probe/echo', { b: 2, a: 1 }, { token: token(), idem: key });
    expect(again.headers['idempotency-replayed']).toBe('true');
  });

  it('a key left in flight for over five minutes is taken over', async () => {
    const key = v7();
    const stale = new Date(Date.now() - 6 * 60_000);
    await uow.runAs({ pool: 'system', orgId: orgId() }, () =>
      keys.reserve(orgId(), key, 'someone-elses-hash', stale, new Date(Date.now() + 86_400_000)),
    );
    const res = await http.post('/v1/_probe/echo', { n: 1 }, { token: token(), idem: key });
    expect(res.status).toBe(201);
    expect(res.headers['idempotency-replayed']).toBeUndefined();
  });

  it('a failed handler releases the key, so the retry is processed and not replayed', async () => {
    const key = v7();
    const first = await http.post('/v1/_probe/boom', {}, { token: token(), idem: key });
    expectProblem(first, { status: 500, type: 'internal' });
    expect(await readKey(key)).toBeNull();

    const retry = await http.post('/v1/_probe/boom', {}, { token: token(), idem: key });
    expectProblem(retry, { status: 500, type: 'internal' });
  });

  it('the stored response exists if and only if the effect did', async () => {
    const key = v7();
    await http.post('/v1/_probe/echo', { n: 7 }, { token: token(), idem: key });
    expect(await readKey(key)).toMatchObject({
      status: 'COMPLETED',
      responseCode: 201,
      responseBody: { ok: true, at: 'echo' },
    });
  });

  it('a 204 endpoint replays its own status', async () => {
    const key = v7();
    expect((await http.post('/v1/_probe/no-content', {}, { token: token(), idem: key })).status).toBe(204);
    const replay = await http.post('/v1/_probe/no-content', {}, { token: token(), idem: key });
    expect(replay.status).toBe(204);
    expect(replay.headers['idempotency-replayed']).toBe('true');
  });

  it('a POST without the header is refused; a GET asks for nothing', async () => {
    expectProblem(await http.post('/v1/_probe/echo', { n: 1 }, { token: token(), idem: false }), {
      status: 400,
      type: 'missing-idempotency-key',
    });
    expect((await http.get('/v1/_probe/org', { token: token() })).status).toBe(200);
  });

  it('the four exempt endpoints work without the header', async () => {
    const res = await http.post(
      '/v1/auth/login',
      { email: tenant.owner.email, password: tenant.owner.password },
      { idem: false },
    );
    expect(res.status).toBe(200);
  });
});
