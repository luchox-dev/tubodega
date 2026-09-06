// Boots the real application in-process (no port) for e2e and edge tests.
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../../../apps/tubodega/src/app.module.js';
import { configureApp } from '../../../apps/tubodega/src/app.setup.js';
import { createTestHttp, type TestHttp } from './http.js';

export interface TestApp {
  readonly app: NestFastifyApplication;
  readonly http: TestHttp;
  stop(): Promise<void>;
}

export async function startTestApp(customize?: (b: TestingModuleBuilder) => TestingModuleBuilder): Promise<TestApp> {
  let builder = Test.createTestingModule({ imports: [AppModule] });
  if (customize) builder = customize(builder);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), { logger: false });
  await configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return { app, http: createTestHttp(app), stop: () => app.close() };
}
