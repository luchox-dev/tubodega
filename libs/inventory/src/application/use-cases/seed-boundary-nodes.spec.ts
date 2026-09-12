import type { OrgId } from '@app/common';
import { NodeKind } from '@app/inventory';
import { InMemoryNodeRepository, fakeIds } from '../../../test/doubles/in-memory.js';
import { BOUNDARY_NODES, SeedBoundaryNodes } from './seed-boundary-nodes.js';

const ORG = '018f0000-0000-7000-8000-0000000000aa' as OrgId;

describe('SeedBoundaryNodes', () => {
  const build = () => {
    const nodes = new InMemoryNodeRepository();
    return { nodes, seed: new SeedBoundaryNodes(nodes, fakeIds) };
  };

  it('deja los ocho nodos de [04 §6]: 3 SOURCE y 5 TERMINAL', async () => {
    const t = build();
    await t.seed.execute(ORG);
    const all = [...t.nodes.rows.values()];
    expect(all).toHaveLength(8);
    expect(all.filter((n) => n.kind === NodeKind.SOURCE)).toHaveLength(3);
    expect(all.filter((n) => n.kind === NodeKind.TERMINAL)).toHaveLength(5);
    expect(all.map((n) => n.code).sort()).toEqual(
      ['adjustment-in', 'adjustment-out', 'consumption', 'opening-balance', 'sale', 'shrinkage', 'supplier-default', 'supplier-return'],
    );
  });

  it('son todos raíz: la frontera no anida', async () => {
    const t = build();
    await t.seed.execute(ORG);
    for (const n of t.nodes.rows.values()) {
      expect(n.parentId).toBeUndefined();
      expect(n.path).toBe(n.code);
      expect(n.isBoundary()).toBe(true);
    }
  });

  // Idempotent by code, and reading before writing: a 23505 would abort the
  // very transaction that creates the organization.
  it('sembrar dos veces deja ocho, no dieciséis', async () => {
    const t = build();
    await t.seed.execute(ORG);
    await t.seed.execute(ORG);
    expect(t.nodes.rows.size).toBe(8);
  });

  it('cada organización tiene los suyos', async () => {
    const t = build();
    const otra = '018f0000-0000-7000-8000-0000000000bb' as OrgId;
    await t.seed.execute(ORG);
    await t.seed.execute(otra);
    expect(t.nodes.rows.size).toBe(16);
  });

  // Nobody "created" these: organization.created already tells the story.
  it('no publica eventos (D-26)', async () => {
    const t = build();
    // The use case takes no publisher at all — the constructor is the assertion.
    expect(SeedBoundaryNodes.length).toBe(2);
    await t.seed.execute(ORG);
  });

  it('la lista es la de la spec, con sus nombres en español', () => {
    expect(BOUNDARY_NODES).toHaveLength(8);
    expect(BOUNDARY_NODES.find((n) => n.code === 'supplier-default')?.name).toBe('Proveedor sin especificar');
  });
});
