import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { EnvironmentVariables } from '@app/common';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  await configureApp(app);

  const config = app.get(ConfigService<EnvironmentVariables, true>);
  const port = config.get('PORT', { infer: true });

  // Bind 0.0.0.0 explicitly: the Fastify adapter otherwise listens on
  // 127.0.0.1, which is unreachable from outside a container.
  await app.listen(port, '0.0.0.0');
}

await bootstrap();
