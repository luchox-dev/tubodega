// A thin client over fastify.inject(): speaks only the public contract and
// never touches the database (spec 06 §6).
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { v7 } from 'uuid';

export interface Req {
  token?: string;
  /** Idempotency-Key: a UUIDv7 is generated for POST unless `false` (the four exempt endpoints). */
  idem?: string | false;
  headers?: Record<string, string>;
}

export interface Res {
  status: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  body: any;
  headers: Record<string, string>;
}

export interface TestHttp {
  get(url: string, o?: Req): Promise<Res>;
  post(url: string, body: unknown, o?: Req): Promise<Res>;
  patch(url: string, body: unknown, o: Req & { ifMatch: number }): Promise<Res>;
  put(url: string, body: unknown, o?: Req & { ifMatch?: number }): Promise<Res>;
  del(url: string, o?: Req): Promise<Res>;
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

export function createTestHttp(app: NestFastifyApplication): TestHttp {
  const fastify = app.getHttpAdapter().getInstance();

  async function send(method: Method, url: string, body: unknown, o: Req & { ifMatch?: number } = {}): Promise<Res> {
    const headers: Record<string, string> = { ...(o.headers ?? {}) };
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    if (method === 'POST' && o.idem !== false) headers['idempotency-key'] = o.idem ?? v7();
    if (o.ifMatch !== undefined) headers['if-match'] = `"${o.ifMatch}"`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await fastify.inject({ method, url, headers, payload: body === undefined ? undefined : JSON.stringify(body) });
    let parsed: unknown = res.payload;
    try {
      parsed = res.payload ? JSON.parse(res.payload) : undefined;
    } catch {
      /* not JSON */
    }
    const flat: Record<string, string> = {};
    for (const [k, v] of Object.entries(res.headers)) flat[k.toLowerCase()] = Array.isArray(v) ? v.join(', ') : String(v);
    return { status: res.statusCode, body: parsed, headers: flat };
  }

  return {
    get: (url, o) => send('GET', url, undefined, o),
    post: (url, body, o) => send('POST', url, body, o),
    patch: (url, body, o) => send('PATCH', url, body, o),
    put: (url, body, o) => send('PUT', url, body, o),
    del: (url, o) => send('DELETE', url, undefined, o),
  };
}
