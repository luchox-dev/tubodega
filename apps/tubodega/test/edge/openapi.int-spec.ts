// The contract is generated from the code, and the snapshot is what makes a
// change to it visible in a diff (spec 03 §10).
import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { OpenAPIObject } from '@nestjs/swagger';
import { startTestApp, type TestApp } from '../../../../test/support/e2e/app.js';

const SNAPSHOT = fileURLToPath(new URL('../../openapi.json', import.meta.url));

/** `pnpm openapi:write` runs this same file with the flag on. */
const UPDATING = process.env.UPDATE_OPENAPI === '1';

describe('OpenAPI document', () => {
  let started: TestApp;
  let document: OpenAPIObject;

  beforeAll(async () => {
    started = await startTestApp();
    const res = await started.http.get('/v1/openapi.json');
    document = res.body as OpenAPIObject;
    if (UPDATING) writeFileSync(SNAPSHOT, `${JSON.stringify(document, null, 2)}\n`);
  });
  afterAll(() => started.stop());

  it('publishes every endpoint of spec 10 §7, 11 §7, 12 §7 and 13 §10', () => {
    const paths = Object.keys(document.paths);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/v1/organizations',
        '/v1/auth/login',
        '/v1/auth/refresh',
        '/v1/auth/logout',
        '/v1/me',
        '/v1/me/password',
        '/v1/users',
        '/v1/users/{id}',
        '/v1/products',
        '/v1/products/{id}',
        '/v1/products/import',
        '/v1/products/{id}/codes',
        '/v1/products/{id}/codes/{codeId}',
        '/v1/products/{id}/batches',
        '/v1/products/{id}/media',
        '/v1/products/{id}/media/{mediaId}',
        '/v1/codes/{value}/resolve',
        '/v1/custom-fields',
        '/v1/custom-fields/{id}',
        '/v1/uploads',
        '/v1/nodes',
        '/v1/nodes/{id}',
        '/v1/nodes/{id}/move',
        '/v1/nodes/{id}/tree',
        '/v1/movements',
        '/v1/movements/batch',
        '/v1/movements/{id}',
        '/v1/movements/{id}/reverse',
        '/v1/stock',
        '/v1/stock/custodies',
        '/v1/process-templates',
        '/v1/process-templates/{code}',
        '/v1/process-templates/{code}/versions',
        '/v1/process-instances',
        '/v1/process-instances/{id}',
        '/v1/process-instances/{id}/steps/{stepId}/complete',
        '/v1/process-instances/{id}/cancel',
      ]),
    );
  });

  it('every operation declares at least one error response', () => {
    const missing: string[] = [];
    for (const [path, item] of Object.entries(document.paths)) {
      for (const [method, op] of Object.entries(item as Record<string, { responses?: object }>)) {
        if (!op?.responses) continue;
        const codes = Object.keys(op.responses).map(Number);
        if (!codes.some((c) => c >= 400)) missing.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('every property of every schema carries an example', () => {
    const missing: string[] = [];
    for (const [name, schema] of Object.entries(document.components?.schemas ?? {})) {
      for (const [prop, def] of Object.entries(
        (schema as { properties?: Record<string, Record<string, unknown>> }).properties ?? {},
      )) {
        const described = 'example' in def || 'enum' in def || '$ref' in def || 'items' in def || 'allOf' in def;
        if (!described) missing.push(`${name}.${prop}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('matches the versioned snapshot', async () => {
    const onDisk: unknown = JSON.parse(await readFile(SNAPSHOT, 'utf8'));
    expect(document).toEqual(onDisk);
  });
});
