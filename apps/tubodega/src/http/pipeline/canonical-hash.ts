import { createHash } from 'node:crypto';

/**
 * `request_hash` of spec 07 §5: SHA-256 of the canonicalised body — JSON with
 * sorted keys and no whitespace, or the raw bytes for multipart. Headers and
 * query string are deliberately left out: two legitimate retries of the same
 * operation may differ in them.
 */
export function canonicalHash(body: unknown): string {
  const hash = createHash('sha256');
  if (Buffer.isBuffer(body)) return hash.update(body).digest('hex');
  return hash.update(canonicalize(body)).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === undefined) return '';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(',')}}`;
}
