import { unwrap } from '@app/common';
import { NodeKind } from '@app/inventory';
import { ProcessContext } from '../context.js';
import { NodeRole } from '../step-types.js';
import { SelectNodeHandler } from './select-node.js';
import { fakeHandlerDeps, unNodo } from '../../../test/doubles/fake-handler-deps.js';
import type { NodeId } from '@app/inventory';

const h = new SelectNodeHandler();
const ctx = ProcessContext.empty();

const B2 = unNodo('B2');
const PROVEEDOR = unNodo('supplier-default', NodeKind.SOURCE);
const VENTA = unNodo('sale', NodeKind.TERMINAL);
const JUAN = unNodo('juan', NodeKind.CUSTODY);
const RETIRADO = unNodo('B9').deactivate();
const deps = fakeHandlerDeps({ nodos: [B2, PROVEEDOR, VENTA, JUAN, RETIRADO] });

const DESTINO_INTERNO = { role: NodeRole.TO, allowedKinds: [NodeKind.INTERNAL] };
const ORIGEN_FUENTE = { role: NodeRole.FROM, allowedKinds: [NodeKind.SOURCE] };

describe('SELECT_NODE', () => {
  /**
   * Es un solo manejador parametrizado y no dos: validar un nodo es idéntico
   * en los dos lados, y lo único que cambia es dónde deja el resultado. Es lo
   * que hace que seis plantillas se armen con ocho piezas.
   */
  it('el `role` del config decide el lado del borrador', async () => {
    const p = unwrap(h.parse({ nodeId: B2.id }));
    expect(h.apply(p, ctx, DESTINO_INTERNO).draft.toNodeId).toBe(B2.id);
    expect(h.apply(p, ctx, DESTINO_INTERNO).draft.fromNodeId).toBeUndefined();

    const q = unwrap(h.parse({ nodeId: PROVEEDOR.id }));
    expect(h.apply(q, ctx, ORIGEN_FUENTE).draft.fromNodeId).toBe(PROVEEDOR.id);
  });

  it('sin `role` en el config, el nodo va al destino', () => {
    expect(h.apply(unwrap(h.parse({ nodeId: B2.id })), ctx, {}).draft.toNodeId).toBe(B2.id);
  });

  it('`allowedKinds` es lo único que separa una recepción de un traslado', async () => {
    expect((await h.validate(unwrap(h.parse({ nodeId: PROVEEDOR.id })), ctx, deps, ORIGEN_FUENTE)).ok).toBe(true);

    const r = await h.validate(unwrap(h.parse({ nodeId: B2.id })), ctx, deps, ORIGEN_FUENTE);
    expect(!r.ok && r.error.type).toBe('invalid-step-payload');
    expect(!r.ok && r.error.message).toContain('INTERNAL');
    expect(!r.ok && r.error.message).toContain('SOURCE');
  });

  it('cada plantilla admite su tipo: TERMINAL para la salida, CUSTODY para el préstamo', async () => {
    const terminal = { role: NodeRole.TO, allowedKinds: [NodeKind.TERMINAL] };
    const custodia = { role: NodeRole.TO, allowedKinds: [NodeKind.CUSTODY] };
    expect((await h.validate(unwrap(h.parse({ nodeId: VENTA.id })), ctx, deps, terminal)).ok).toBe(true);
    expect((await h.validate(unwrap(h.parse({ nodeId: JUAN.id })), ctx, deps, custodia)).ok).toBe(true);
    expect((await h.validate(unwrap(h.parse({ nodeId: VENTA.id })), ctx, deps, custodia)).ok).toBe(false);
  });

  it('sin `allowedKinds` vale cualquier tipo', async () => {
    expect((await h.validate(unwrap(h.parse({ nodeId: VENTA.id })), ctx, deps, {})).ok).toBe(true);
  });

  it('un nodo que no existe en esta organización no vale (I-6)', async () => {
    const r = await h.validate({ nodeId: 'no-existe' as NodeId }, ctx, deps, DESTINO_INTERNO);
    expect(!r.ok && r.error.message).toContain('no existe');
  });

  // I-16: los movimientos ya asentados siguen valiendo; los nuevos no ocurren.
  it('un nodo inactivo no admite movimientos nuevos', async () => {
    const r = await h.validate(unwrap(h.parse({ nodeId: RETIRADO.id })), ctx, deps, DESTINO_INTERNO);
    expect(!r.ok && r.error.message).toContain('inactivo');
  });

  it('un payload sin nodo, o null, es invalid-step-payload en /nodeId', () => {
    for (const raw of [{}, { nodeId: '' }, { nodeId: 7 }, null]) {
      const r = h.parse(raw);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.error.errors?.[0]?.pointer).toBe('/nodeId');
    }
  });
});
