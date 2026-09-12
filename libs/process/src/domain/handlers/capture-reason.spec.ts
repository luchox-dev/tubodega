import { unwrap } from '@app/common';
import { ProcessContext } from '../context.js';
import { CaptureReasonHandler } from './capture-reason.js';
import { fakeHandlerDeps } from '../../../test/doubles/fake-handler-deps.js';

const h = new CaptureReasonHandler();
const ctx = ProcessContext.empty();

describe('CAPTURE_REASON', () => {
  it('deja el motivo, recortado, en el borrador', async () => {
    const p = unwrap(await h.validate(unwrap(h.parse({ reason: '  conteo cíclico  ' })), ctx, fakeHandlerDeps(), {}));
    expect(h.apply(p, ctx).draft.reason).toBe('conteo cíclico');
  });

  it('de 3 a 500 caracteres', () => {
    expect(h.parse({ reason: 'abc' }).ok).toBe(true);
    expect(h.parse({ reason: 'a'.repeat(500) }).ok).toBe(true);
    expect(h.parse({ reason: 'a'.repeat(501) }).ok).toBe(false);
  });

  it('lo corto, lo ausente y null son invalid-step-payload en /reason', () => {
    for (const raw of [{ reason: 'ab' }, { reason: '   ' }, {}, { reason: 3 }, null]) {
      const r = h.parse(raw);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error.errors?.[0]?.pointer).toBe('/reason');
    }
  });
});
