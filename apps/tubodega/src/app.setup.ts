import multipart from '@fastify/multipart';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { MAX_MEDIA_BYTES } from '@app/catalog';
import { ID_GENERATOR, type IdGenerator } from '@app/common';
import { registerTraceIdHook } from './http/pipeline/trace-id.hook.js';
import { OpenApiDocument, buildOpenApi } from './http/openapi/openapi.controller.js';
import { buildValidationPipe } from './http/pipeline/validation.pipe.js';

/**
 * Everything main.ts and the test harness must both do to an application:
 * prefix, multipart, trace hook, validation pipe, OpenAPI. Guard, interceptors
 * and the exception filter are registered by AppModule so they get dependency
 * injection.
 */
export async function configureApp(app: NestFastifyApplication): Promise<NestFastifyApplication> {
  app.setGlobalPrefix('v1');
  // The limit is enforced here as well as in the use case: refusing eleven
  // megabytes after reading them is a denial of service waiting to happen.
  await app.register(multipart, { limits: { fileSize: MAX_MEDIA_BYTES, files: 20 } });
  registerTraceIdHook(app.getHttpAdapter().getInstance(), app.get<IdGenerator>(ID_GENERATOR));
  app.useGlobalPipes(buildValidationPipe());
  app.get(OpenApiDocument).set(buildOpenApi(app));
  return app;
}
