import { unwrap } from '@app/common';
import { ProcessContext } from '../context.js';
import { SetDueDateHandler } from './set-due-date.js';
import { AHORA, fakeHandlerDeps } from '../../../test/doubles/fake-handler-deps.js';

const h = new SetDueDateHandler();
const ctx = ProcessContext.empty();
const deps = fakeHandlerDeps();
const enDias = (n: number) => new Date(AHORA.getTime() + n * 86_400_000);

describe('SET_DUE_DATE', () => {
  it('acepta una fecha futura, como Date o como ISO, y la deja en el borrador', async () => {
    for (const dueAt of [enDias(7), enDias(7).toISOString()]) {
      const p = unwrap(await h.validate(unwrap(h.parse({ dueAt })), ctx, deps, {}));
      expect(h.apply(p, ctx).draft.dueAt).toEqual(enDias(7));
    }
  });

  // Ninguna regla de la casa llama a new Date(): "futura" es una pregunta sobre
  // el ahora, y el ahora es un puerto.
  it('el pasado y el ahora exacto no son futuro, y se mide contra el reloj inyectado', async () => {
    for (const dueAt of [enDias(-1), AHORA]) {
      const r = await h.validate(unwrap(h.parse({ dueAt })), ctx, deps, {});
      expect(!r.ok && r.error.type).toBe('invalid-step-payload');
      expect(!r.ok && r.error.message).toContain('futura');
    }
    // Con el reloj atrasado, esa misma fecha sí es futura.
    const otro = fakeHandlerDeps({ ahora: enDias(-30) });
    expect((await h.validate(unwrap(h.parse({ dueAt: enDias(-1) })), ctx, otro, {})).ok).toBe(true);
  });

  it('lo que no es una fecha, lo ausente y null son invalid-step-payload en /dueAt', () => {
    for (const raw of [{ dueAt: 'mañana' }, { dueAt: 7 }, {}, null]) {
      const r = h.parse(raw);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error.errors?.[0]?.pointer).toBe('/dueAt');
    }
  });
});
