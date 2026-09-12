import { unwrap } from '@app/common';
import { ProcessContext } from '../context.js';
import { CaptureQtyHandler } from './capture-qty.js';
import { fakeHandlerDeps, unProducto } from '../../../test/doubles/fake-handler-deps.js';

const h = new CaptureQtyHandler();

const tornillo = unProducto({ sku: 'TOR-M8', uom: 'UNIT' });
const arroz = unProducto({ sku: 'ARROZ-25', uom: 'KG' });
const deps = fakeHandlerDeps({ productos: [tornillo, arroz] });
const conProducto = (p = tornillo) => ProcessContext.empty().withDraft({ productId: p.id });

describe('CAPTURE_QTY', () => {

  it('deja la cantidad en el borrador', async () => {
    const p = unwrap(await h.validate(unwrap(h.parse({ quantity: '10' })), conProducto(), deps, {}));
    expect(h.apply(p, conProducto()).draft.quantity?.toString()).toBe('10.000');
  });

  it('los kilos sí admiten decimales', async () => {
    const p = unwrap(h.parse({ quantity: '2.5' }));
    expect((await h.validate(p, conProducto(arroz), deps, {})).ok).toBe(true);
  });

  // Medio tornillo no es medio de nada.
  it('UNIT, BOX y PACK no admiten decimales', async () => {
    const p = unwrap(h.parse({ quantity: '2.5' }));
    const r = await h.validate(p, conProducto(), deps, {});
    expect(!r.ok && r.error.type).toBe('invalid-step-payload');
    expect(!r.ok && r.error.message).toContain('sin decimales');
  });

  // I-2: una cantidad se escribe en positivo, y la dirección vive en el par de nodos.
  it('el cero, el negativo y lo que no es un número son invalid-step-payload en /quantity', () => {
    for (const raw of [{ quantity: '0' }, { quantity: '-3' }, { quantity: 'tres' }, { quantity: 3 }, {}, null]) {
      const r = h.parse(raw);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error.errors?.[0]?.pointer).toBe('/quantity');
    }
  });

  it('sin producto en el borrador, dice que falta el producto', async () => {
    const r = await h.validate(unwrap(h.parse({ quantity: '1' })), ProcessContext.empty(), deps, {});
    expect(!r.ok && r.error.type).toBe('incomplete-draft');
  });

  it('un producto que ya no está tampoco vale', async () => {
    const fantasma = unProducto({ sku: 'FANTASMA' });
    const r = await h.validate(unwrap(h.parse({ quantity: '1' })), conProducto(fantasma), deps, {});
    expect(!r.ok && r.error.type).toBe('incomplete-draft');
  });
});

describe('CAPTURE_QTY · los bordes', () => {
  it('una cantidad sin parsear no pasa por unidad entera, y apply no la inventa', async () => {
    const sinValor = { quantity: '2.5' };
    expect((await h.validate(sinValor, conProducto(), deps, {})).ok).toBe(false);
    expect(h.apply(sinValor, conProducto()).draft.quantity).toBeUndefined();
  });
});
