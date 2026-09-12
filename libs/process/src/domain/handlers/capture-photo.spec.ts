import { unwrap } from '@app/common';
import type { StorageKey } from '@app/catalog';
import { ProcessContext } from '../context.js';
import { CapturePhotoHandler } from './capture-photo.js';
import type { StepHandler } from './handler.js';
import { fakeHandlerDeps } from '../../../test/doubles/fake-handler-deps.js';

const h = new CapturePhotoHandler();
const ctx = ProcessContext.empty();
const claves = (n: number) => Array.from({ length: n }, (_, i) => `org/foto-${i}`);

describe('CAPTURE_PHOTO', () => {
  it('acumula las claves en el contexto, no en el borrador', async () => {
    const p = unwrap(await h.validate(unwrap(h.parse({ storageKeys: claves(2) })), ctx, fakeHandlerDeps(), {}));
    const out = h.apply(p, ctx);
    expect(out.storageKeys).toEqual(['org/foto-0', 'org/foto-1']);
    expect(out.draft).toEqual({});
  });

  it('no produce ningún efecto: apply no tiene por dónde devolverlo (P-6)', () => {
    // En la tabla de [13 §5] parecía producir ATTACH_MEDIA. No lo hace: las
    // claves se acumulan y es CONFIRM quien emite el efecto al cerrar.
    const comoLoVeElMotor: StepHandler = h;
    expect(comoLoVeElMotor.effects).toBeUndefined();
  });

  it('de 1 a 5 imágenes', () => {
    expect(h.parse({ storageKeys: claves(1) }).ok).toBe(true);
    expect(h.parse({ storageKeys: claves(5) }).ok).toBe(true);
    expect(h.parse({ storageKeys: claves(6) }).ok).toBe(false);
    expect(h.parse({ storageKeys: [] }).ok).toBe(false);
  });

  it('lo que no es una lista de claves, y null, son invalid-step-payload en /storageKeys', () => {
    for (const raw of [{ storageKeys: 'org/a' }, { storageKeys: ['', 'org/a'] }, { storageKeys: [7] }, {}, null]) {
      const r = h.parse(raw);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error.errors?.[0]?.pointer).toBe('/storageKeys');
    }
  });

  it('acumula sobre lo que ya hubiera', () => {
    const antes = ctx.withStorageKeys(['org/vieja' as StorageKey]);
    const p = unwrap(h.parse({ storageKeys: claves(1) }));
    expect(h.apply(p, antes).storageKeys).toEqual(['org/vieja', 'org/foto-0']);
  });
});
