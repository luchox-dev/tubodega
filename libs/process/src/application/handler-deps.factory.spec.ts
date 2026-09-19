import { v7 } from 'uuid';
import { unwrap, type OrgId } from '@app/common';
import { Batch, Product, TrackingMode, type BatchId, type ProductId } from '@app/catalog';
import { Node, NodeKind, type NodeCode, type NodeId } from '@app/inventory';
import { aContext } from '../../test/builders/a-context.js';
import { ORG } from '../../test/builders/a-template.js';
import { HandlerDepsFactory } from './handler-deps.factory.js';

const AHORA = new Date('2026-09-19T10:00:00.000Z');

const producto = unwrap(Product.create({
  id: v7() as ProductId, orgId: ORG, sku: 'LECHE-1L', name: 'Leche',
  trackingMode: TrackingMode.LOT, uom: 'UNIT',
}));
const lote = unwrap(Batch.create({ id: v7() as BatchId, product: producto, lotCode: 'L-1' }));
const taladro = unwrap(Product.create({
  id: v7() as ProductId, orgId: ORG, sku: 'TAL-BOSCH', name: 'Taladro',
  trackingMode: TrackingMode.SERIAL, uom: 'UNIT',
}));
const serie = unwrap(Batch.create({ id: v7() as BatchId, product: taladro, serial: 'BSH-001' }));
const nodo = unwrap(Node.create({ id: v7() as NodeId, orgId: ORG, kind: NodeKind.INTERNAL, code: 'B2', name: 'B2' }));

/**
 * Los dobles llevan la cuenta del `orgId` con que se les llamó: es lo único que
 * la fábrica tiene que aportar, y lo que un puerto puente habría escondido.
 */
const build = () => {
  const vistos: OrgId[] = [];
  const nodes = {
    findById: (orgId: OrgId, id: NodeId) => { vistos.push(orgId); return Promise.resolve(id === nodo.id ? nodo : null); },
    findByCode: (orgId: OrgId, code: NodeCode) => { vistos.push(orgId); return Promise.resolve(code === 'B2' ? nodo : null); },
  };
  const products = {
    findById: (orgId: OrgId, id: ProductId) => { vistos.push(orgId); return Promise.resolve(id === producto.id ? producto : null); },
  };
  const batches = {
    findByLotCode: (orgId: OrgId, p: ProductId, code: string) => {
      vistos.push(orgId);
      return Promise.resolve(p === producto.id && code === 'L-1' ? lote : null);
    },
    findBySerial: (orgId: OrgId, s: string) => { vistos.push(orgId); return Promise.resolve(s === 'BSH-001' ? serie : null); },
  };
  const resolve = {
    execute: (_ctx: unknown, raw: string) =>
      Promise.resolve(raw === '7501' ? { product: producto } : null),
  };
  const factory = new HandlerDepsFactory(
    resolve as never, nodes as never, products as never, batches as never, { now: () => AHORA },
  );
  return { factory, vistos };
};

describe('HandlerDepsFactory', () => {
  it('las seis lecturas resuelven contra los repositorios reales', async () => {
    const { factory } = build();
    const deps = factory.for(aContext());

    expect((await deps.resolveCode(ORG, '7501'))?.product.sku).toBe('LECHE-1L');
    expect(await deps.resolveCode(ORG, 'nada')).toBeNull();
    expect((await deps.findNode(ORG, nodo.id))?.code).toBe('B2');
    expect((await deps.findNodeByCode(ORG, 'B2'))?.id).toBe(nodo.id);
    expect((await deps.findProduct(ORG, producto.id))?.sku).toBe('LECHE-1L');
    expect((await deps.findBatchByLot(ORG, producto.id, 'L-1'))?.id).toBe(lote.id);
    expect((await deps.findBatchBySerial(ORG, 'BSH-001'))?.id).toBe(serie.id);
  });

  it('el orgId sale del contexto: el manejador no tiene de dónde sacarlo (D-53)', () => {
    const { factory } = build();
    expect(factory.for(aContext()).orgId).toBe(ORG);
  });

  it('el orgId que llega al repositorio es el del contexto, no el del argumento', async () => {
    const { factory, vistos } = build();
    const deps = factory.for(aContext());
    // El manejador pasa `deps.orgId`; que el puente lo respete es lo que evita
    // que una lectura se escape de la organización por un argumento suelto.
    await deps.findNode(deps.orgId, nodo.id);
    expect(vistos).toEqual([ORG]);
  });

  it('el reloj es el puerto, no `new Date()` (spec 06 §4)', () => {
    const { factory } = build();
    expect(factory.for(aContext()).clock.now()).toEqual(AHORA);
  });
});
