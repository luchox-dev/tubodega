import { Controller, Get, Injectable, type INestApplication } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { Public } from '../pipeline/public.decorator.js';

/** Holds the document generated at boot so the controller can serve it (spec 03 §10). */
@Injectable()
export class OpenApiDocument {
  private document?: OpenAPIObject;
  set(document: OpenAPIObject): void {
    this.document = document;
  }
  get(): OpenAPIObject {
    if (!this.document) throw new Error('OpenAPI document not built yet');
    return this.document;
  }
}

/** Generated from the code and served at /v1/openapi.json. No UI: the JSON is the contract. */
export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('tubodega')
    .setDescription('WMS de movimientos: contrato público v1')
    .setVersion('1')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}

@Controller('openapi.json')
export class OpenApiController {
  constructor(private readonly document: OpenApiDocument) {}

  @Public()
  @Get()
  @ApiExcludeEndpoint()
  get(): OpenAPIObject {
    return this.document.get();
  }
}
