import type { Res } from './http.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Asserts the full problem+json shape of spec 03 §5, not just the status. */
export function expectProblem(res: Res, expected: { status: number; type: string; pointer?: string }): void {
  expect(res.status).toBe(expected.status);
  expect(res.headers['content-type']).toMatch(/^application\/problem\+json/);
  expect(res.body).toMatchObject({
    type: `https://tubodega.app/errors/${expected.type}`,
    status: expected.status,
  });
  expect(typeof res.body.title).toBe('string');
  expect(typeof res.body.detail).toBe('string');
  expect(typeof res.body.instance).toBe('string');
  expect(res.body.traceId).toMatch(UUID);
  expect(res.body.traceId).toBe(res.headers['x-request-id']);
  if (expected.pointer) {
    expect(res.body.errors).toEqual(expect.arrayContaining([expect.objectContaining({ pointer: expected.pointer })]));
  }
}
