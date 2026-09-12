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

export interface UploadFile {
  readonly bytes: Buffer;
  readonly contentType: string;
  readonly filename?: string;
}

export interface TestHttp {
  get(url: string, o?: Req): Promise<Res>;
  post(url: string, body: unknown, o?: Req): Promise<Res>;
  patch(url: string, body: unknown, o: Req & { ifMatch: number }): Promise<Res>;
  put(url: string, body: unknown, o?: Req & { ifMatch?: number }): Promise<Res>;
  del(url: string, o?: Req): Promise<Res>;
  /** multipart/form-data, for the two endpoints that take a photo. */
  upload(url: string, files: UploadFile | readonly UploadFile[], o?: Req): Promise<Res>;
}

/** Builds a multipart body by hand: the client speaks the wire format, not an SDK. */
function multipartBody(files: readonly UploadFile[], boundary: string): Buffer {
  const parts: Buffer[] = [];
  for (const [i, f] of files.entries()) {
    const name = f.filename ?? `foto-${i + 1}`;
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${name}"\r\n` +
          `Content-Type: ${f.contentType}\r\n\r\n`,
      ),
      f.bytes,
      Buffer.from('\r\n'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return Buffer.concat(parts);
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

  async function upload(url: string, files: UploadFile | readonly UploadFile[], o: Req = {}): Promise<Res> {
    const list = Array.isArray(files) ? files : [files as UploadFile];
    const boundary = `----tubodega${v7()}`;
    const headers: Record<string, string> = {
      ...(o.headers ?? {}),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    };
    if (o.token) headers.authorization = `Bearer ${o.token}`;
    if (o.idem !== false) headers['idempotency-key'] = o.idem ?? v7();

    const res = await fastify.inject({ method: 'POST', url, headers, payload: multipartBody(list, boundary) });
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
    upload,
    get: (url, o) => send('GET', url, undefined, o),
    post: (url, body, o) => send('POST', url, body, o),
    patch: (url, body, o) => send('PATCH', url, body, o),
    put: (url, body, o) => send('PUT', url, body, o),
    del: (url, o) => send('DELETE', url, undefined, o),
  };
}
