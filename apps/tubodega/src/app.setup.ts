import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ID_GENERATOR, type IdGenerator } from '@app/common';
import { registerTraceIdHook } from './http/context/trace-id.hook.js';
import { OpenApiDocument, buildOpenApi } from './http/openapi/openapi.js';
import { buildValidationPipe } from './http/problem/validation.pipe.js';

/**
 * Everything main.ts and the test harness must both do to an application:
 * prefix, trace hook, validation pipe, OpenAPI. Guard, interceptors and the
 * exception filter are registered by AppModule so they get dependency injection.
 */
export async function configureApp(app: NestFastifyApplication): Promise<NestFastifyApplication> {
  app.setGlobalPrefix('v1');
  registerTraceIdHook(app.getHttpAdapter().getInstance(), app.get<IdGenerator>(ID_GENERATOR));
  app.useGlobalPipes(buildValidationPipe());
  app.get(OpenApiDocument).set(buildOpenApi(app));
  return app;
}
