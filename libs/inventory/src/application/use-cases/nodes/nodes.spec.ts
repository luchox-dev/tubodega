import { unwrap } from '@app/common';
import { CustomEntity, CustomFieldDefinition, CustomType, type CustomFieldId } from '@app/catalog';
import { Role } from '@app/tenancy';
import { MAX_TREE_NODES, NodeKind, type NodeId } from '@app/inventory';
import { ORG, aNode } from '../../../../test/builders/a-node.js';
import { aContext } from '../../../../test/builders/a-context.js';
import {
  InMemoryCustomFieldRepository, InMemoryNodeRepository, InMemoryStockBalanceRepository,
  RecordingEventPublisher, fakeIds, fixedClock,
} from '../../../../test/doubles/in-memory.js';
import { CreateNode } from './create-node.js';
import { DeactivateNode } from './deactivate-node.js';
import { GetNode } from './get-node.js';
import { GetNodeTree } from './get-node-tree.js';
import { ListNodes } from './list-nodes.js';
import { MoveNode } from './move-node.js';
import { UpdateNode } from './update-node.js';

const build = () => {
  const nodes = new InMemoryNodeRepository();
  const balances = new InMemoryStockBalanceRepository();
  const fields = new InMemoryCustomFieldRepository();
  const events = new RecordingEventPublisher();
  return {
    nodes, balances, fields, events,
    create: new CreateNode(nodes, fields, events, fakeIds, fixedClock),
    update: new UpdateNode(nodes, fields, events, fakeIds, fixedClock),
    move: new MoveNode(nodes, events, fakeIds, fixedClock),
    deactivate: new DeactivateNode(nodes, balances, events, fakeIds, fixedClock),
    list: new ListNodes(nodes),
    get: new GetNode(nodes),
    tree: new GetNodeTree(nodes),
  };
};

const PAGE = { limit: 50, sort: { field: 'path', dir: 'asc' } } as const;

/** Builds BOD-A › Z1 › E3 › {B2, B3} and BOD-B › Z2, the warehouse of the narrative. */
async function aWarehouse(t: ReturnType<typeof build>) {
  const ctx = aContext();
  const mk = (code: string, parentId?: string) =>
    t.create.execute(ctx, { kind: NodeKind.INTERNAL, code, name: code, ...(parentId ? { parentId: parentId as NodeId } : {}) });
  const bodA = await mk('BOD-A');
  const z1 = await mk('Z1', bodA.id);
  const e3 = await mk('E3', z1.id);
  const b2 = await mk('B2', e3.id);
  const b3 = await mk('B3', e3.id);
  const bodB = await mk('BOD-B');
  const z2 = await mk('Z2', bodB.id);
  return { ctx, bodA, z1, e3, b2, b3, bodB, z2 };
}

describe('CreateNode', () => {
  it('guarda el nodo y lo anuncia', async () => {
    const t = build();
    const n = await t.create.execute(aContext(), { kind: NodeKind.INTERNAL, code: 'BOD-A', name: 'Bodega A' });
    expect(n.path).toBe('BOD-A');
    expect(t.events.types()).toEqual(['node.created']);
  });

  it('el path cuelga del padre', async () => {
    const t = build();
    const w = await aWarehouse(t);
    expect(w.b2.path).toBe('BOD-A/Z1/E3/B2');
  });

  // I-10, both halves. The schema CHECK only guards the child.
  it('un padre que no es INTERNAL se rechaza (I-10)', async () => {
    const t = build();
    const ctx = aContext();
    const juan = await t.create.execute(ctx, { kind: NodeKind.CUSTODY, code: 'juan', name: 'Juan' });
    await expect(
      t.create.execute(ctx, { kind: NodeKind.INTERNAL, code: 'X', name: 'X', parentId: juan.id }),
    ).rejects.toMatchObject({ type: 'parent-not-internal' });
  });

  it('un hijo que no es INTERNAL tampoco cuelga de nadie (I-10)', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await expect(
      t.create.execute(w.ctx, { kind: NodeKind.CUSTODY, code: 'juan', name: 'Juan', parentId: w.z1.id }),
    ).rejects.toMatchObject({ type: 'parent-not-internal' });
  });

  it('un CUSTODY sin padre sí se crea', async () => {
    const t = build();
    const juan = await t.create.execute(aContext(), { kind: NodeKind.CUSTODY, code: 'juan', name: 'Juan' });
    expect(juan.path).toBe('juan');
    expect(juan.parentId).toBeUndefined();
  });

  it('un padre inexistente es parent-not-found', async () => {
    const t = build();
    await expect(
      t.create.execute(aContext(), { kind: NodeKind.INTERNAL, code: 'X', name: 'X', parentId: 'nope' as NodeId }),
    ).rejects.toMatchObject({ type: 'parent-not-found' });
  });

  it('el código repetido choca (único por organización)', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await expect(
      t.create.execute(w.ctx, { kind: NodeKind.INTERNAL, code: 'B2', name: 'Otro B2' }),
    ).rejects.toMatchObject({ type: 'node-code-taken' });
  });

  it('valida los campos propios de NODE (C-7)', async () => {
    const t = build();
    t.fields.add(
      unwrap(CustomFieldDefinition.create({
        id: 'd' as CustomFieldId, orgId: ORG, entity: CustomEntity.NODE,
        key: 'responsable', label: 'Responsable', type: CustomType.TEXT,
      })),
    );
    await expect(
      t.create.execute(aContext(), { kind: NodeKind.INTERNAL, code: 'X', name: 'X', customFields: { responsable: 42 } }),
    ).rejects.toMatchObject({ type: 'invalid-custom-field' });
  });

  it('un OPERATOR no dibuja la bodega', async () => {
    const t = build();
    await expect(
      t.create.execute(aContext([Role.OPERATOR]), { kind: NodeKind.INTERNAL, code: 'X', name: 'X' }),
    ).rejects.toMatchObject({ type: 'insufficient-role' });
  });
});

describe('UpdateNode', () => {
  it('cambia el nombre sin tocar el path', async () => {
    const t = build();
    const w = await aWarehouse(t);
    const next = await t.update.execute(w.ctx, { id: w.z1.id, name: 'Zona fría', expectedVersion: 1 });
    expect(next.name).toBe('Zona fría');
    expect(next.path).toBe('BOD-A/Z1');
    expect(t.events.types().at(-1)).toBe('node.updated');
  });

  it('un nodo que no existe es 404', async () => {
    const t = build();
    await expect(
      t.update.execute(aContext(), { id: 'nope' as NodeId, name: 'X', expectedVersion: 1 }),
    ).rejects.toMatchObject({ type: 'not-found' });
  });

  it('cambia los campos propios validándolos (C-7)', async () => {
    const t = build();
    t.fields.add(
      unwrap(CustomFieldDefinition.create({
        id: 'd' as CustomFieldId, orgId: ORG, entity: CustomEntity.NODE,
        key: 'responsable', label: 'Responsable', type: CustomType.TEXT,
      })),
    );
    const w = await aWarehouse(t);
    const next = await t.update.execute(w.ctx, {
      id: w.z1.id, customFields: { responsable: 'Juan' }, expectedVersion: 1,
    });
    expect(next.customFields.toJSON()).toEqual({ responsable: 'Juan' });

    await expect(
      t.update.execute(w.ctx, { id: w.z1.id, customFields: { responsable: 42 }, expectedVersion: 1 }),
    ).rejects.toMatchObject({ type: 'invalid-custom-field' });
  });

  it('un VIEWER no edita', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await expect(
      t.update.execute(aContext([Role.VIEWER]), { id: w.z1.id, name: 'X', expectedVersion: 1 }),
    ).rejects.toMatchObject({ type: 'insufficient-role' });
  });
});

describe('MoveNode', () => {
  it('recalcula el path del nodo y de todo su subárbol (N-1, N-2)', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await t.move.execute(w.ctx, { id: w.e3.id, parentId: w.z2.id, expectedVersion: 1 });

    expect((await t.nodes.findById(ORG, w.e3.id))!.path).toBe('BOD-B/Z2/E3');
    expect((await t.nodes.findById(ORG, w.b2.id))!.path).toBe('BOD-B/Z2/E3/B2');
    expect((await t.nodes.findById(ORG, w.b3.id))!.path).toBe('BOD-B/Z2/E3/B3');
    expect(t.events.types().at(-1)).toBe('node.moved');
  });

  it('no arrastra a los que solo comparten prefijo', async () => {
    const t = build();
    const w = await aWarehouse(t);
    // Z10 hangs from BOD-A next to Z1: 'BOD-A/Z1' is its prefix, not its ancestor.
    const z10 = await t.create.execute(w.ctx, { kind: NodeKind.INTERNAL, code: 'Z10', name: 'Z10', parentId: w.bodA.id });
    await t.move.execute(w.ctx, { id: w.z1.id, parentId: w.z2.id, expectedVersion: 1 });
    expect((await t.nodes.findById(ORG, z10.id))!.path).toBe('BOD-A/Z10');
  });

  it('mover a la raíz deja el path en el código', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await t.move.execute(w.ctx, { id: w.e3.id, expectedVersion: 1 });
    expect((await t.nodes.findById(ORG, w.e3.id))!.path).toBe('E3');
    expect((await t.nodes.findById(ORG, w.b2.id))!.path).toBe('E3/B2');
  });

  // Cycle detection three levels deep, with the path and no recursion.
  it('colgar un abuelo de su nieto es un ciclo', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await expect(
      t.move.execute(w.ctx, { id: w.z1.id, parentId: w.b2.id, expectedVersion: 1 }),
    ).rejects.toMatchObject({ type: 'node-cycle' });
  });

  it('colgarse de uno mismo es un ciclo', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await expect(
      t.move.execute(w.ctx, { id: w.z1.id, parentId: w.z1.id, expectedVersion: 1 }),
    ).rejects.toMatchObject({ type: 'node-cycle' });
  });

  it('mover al mismo padre no escribe ni anuncia nada', async () => {
    const t = build();
    const w = await aWarehouse(t);
    const before = t.events.published.length;
    const same = await t.move.execute(w.ctx, { id: w.e3.id, parentId: w.z1.id, expectedVersion: 1 });
    expect(same.path).toBe('BOD-A/Z1/E3');
    expect(t.events.published.length).toBe(before);
  });

  it('el destino tiene que ser INTERNAL (I-10)', async () => {
    const t = build();
    const w = await aWarehouse(t);
    const juan = await t.create.execute(w.ctx, { kind: NodeKind.CUSTODY, code: 'juan', name: 'Juan' });
    await expect(
      t.move.execute(w.ctx, { id: w.e3.id, parentId: juan.id, expectedVersion: 1 }),
    ).rejects.toMatchObject({ type: 'parent-not-internal' });
  });

  it('mover un nodo que no existe es 404', async () => {
    const t = build();
    await expect(
      t.move.execute(aContext(), { id: 'nope' as NodeId, expectedVersion: 1 }),
    ).rejects.toMatchObject({ type: 'not-found' });
  });

  it('un padre inexistente es parent-not-found', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await expect(
      t.move.execute(w.ctx, { id: w.e3.id, parentId: 'nope' as NodeId, expectedVersion: 1 }),
    ).rejects.toMatchObject({ type: 'parent-not-found' });
  });

  it('un CUSTODY no se cuelga de una zona, ni moviéndolo (I-10)', async () => {
    const t = build();
    const w = await aWarehouse(t);
    const juan = await t.create.execute(w.ctx, { kind: NodeKind.CUSTODY, code: 'juan', name: 'Juan' });
    await expect(
      t.move.execute(w.ctx, { id: juan.id, parentId: w.z1.id, expectedVersion: 1 }),
    ).rejects.toMatchObject({ type: 'parent-not-internal' });
  });

  it('un OPERATOR no reorganiza', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await expect(
      t.move.execute(aContext([Role.OPERATOR]), { id: w.e3.id, parentId: w.z2.id, expectedVersion: 1 }),
    ).rejects.toMatchObject({ type: 'insufficient-role' });
  });
});

describe('DeactivateNode', () => {
  it('una hoja vacía se desactiva', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await t.deactivate.execute(w.ctx, w.b3.id);
    expect((await t.nodes.findById(ORG, w.b3.id))!.active).toBe(false);
    expect(t.events.types().at(-1)).toBe('node.deactivated');
  });

  // N-3: goods in a place the system says it does not operate.
  it('con saldo, no (N-3)', async () => {
    const t = build();
    const w = await aWarehouse(t);
    t.balances.byNode.set(w.b3.id, [{ productId: 'p1', quantity: '4.000' }]);
    await expect(t.deactivate.execute(w.ctx, w.b3.id)).rejects.toMatchObject({
      type: 'node-has-stock',
    });
    expect((await t.nodes.findById(ORG, w.b3.id))!.active).toBe(true);
  });

  // D-30: no cascade, no shrug.
  it('con hijos activos, tampoco (D-30)', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await expect(t.deactivate.execute(w.ctx, w.z1.id)).rejects.toMatchObject({
      type: 'node-has-children',
    });
  });

  it('si los hijos ya están inactivos, el padre sí se desactiva', async () => {
    const t = build();
    const w = await aWarehouse(t);
    for (const id of [w.b2.id, w.b3.id, w.e3.id]) await t.deactivate.execute(w.ctx, id);
    await t.deactivate.execute(w.ctx, w.z1.id);
    expect((await t.nodes.findById(ORG, w.z1.id))!.active).toBe(false);
  });

  it('desactivar dos veces no anuncia dos veces', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await t.deactivate.execute(w.ctx, w.b3.id);
    const after = t.events.published.length;
    await t.deactivate.execute(w.ctx, w.b3.id);
    expect(t.events.published.length).toBe(after);
  });

  it('un nodo que no existe es 404', async () => {
    const t = build();
    await expect(t.deactivate.execute(aContext(), 'nope' as NodeId)).rejects.toMatchObject({
      type: 'not-found',
    });
  });
});

describe('ListNodes y GetNode', () => {
  it('filtra por tipo y por actividad', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await t.create.execute(w.ctx, { kind: NodeKind.SOURCE, code: 'sale', name: 'Venta' });
    const internals = await t.list.execute(w.ctx, { ...PAGE, kind: NodeKind.INTERNAL });
    expect(internals.data.every((n) => n.kind === NodeKind.INTERNAL)).toBe(true);

    await t.deactivate.execute(w.ctx, w.b3.id);
    const inactive = await t.list.execute(w.ctx, { ...PAGE, active: false });
    expect(inactive.data.map((n) => n.code)).toEqual(['B3']);
  });

  it('under devuelve el subárbol estricto', async () => {
    const t = build();
    const w = await aWarehouse(t);
    const under = await t.list.execute(w.ctx, { ...PAGE, under: w.z1.id });
    expect(under.data.map((n) => n.code).sort()).toEqual(['B2', 'B3', 'E3']);
  });

  // Decision D-28: the filter is declared, so it is not invalid-filter by name;
  // its value naming nothing is, and an empty page would hide the typo.
  it('un under inexistente es 400 invalid-filter, no una página vacía (D-28)', async () => {
    const t = build();
    await expect(
      t.list.execute(aContext(), { ...PAGE, under: 'nope' as NodeId }),
    ).rejects.toMatchObject({ type: 'invalid-filter', status: 400 });
  });

  it('pagina por cursor sin repetir ni saltar', async () => {
    const t = build();
    const w = await aWarehouse(t);
    const first = await t.list.execute(w.ctx, { ...PAGE, limit: 3 });
    expect(first.data).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    const second = await t.list.execute(w.ctx, { ...PAGE, limit: 3, cursor: first.nextCursor! });
    expect(second.data.map((n) => n.id)).not.toContain(first.data[0]!.id);
  });

  it('un VIEWER sí puede leer', async () => {
    const t = build();
    await aWarehouse(t);
    const page = await t.list.execute(aContext([Role.VIEWER]), PAGE);
    expect(page.data.length).toBeGreaterThan(0);
  });

  it('GetNode devuelve uno, y 404 si no está', async () => {
    const t = build();
    const w = await aWarehouse(t);
    expect((await t.get.execute(w.ctx, w.z1.id)).code).toBe('Z1');
    await expect(t.get.execute(w.ctx, 'nope' as NodeId)).rejects.toMatchObject({ type: 'not-found' });
  });
});

describe('GetNodeTree', () => {
  it('anida el subárbol completo (D-11)', async () => {
    const t = build();
    const w = await aWarehouse(t);
    const tree = await t.tree.execute(w.ctx, w.bodA.id);
    expect(tree.node.code).toBe('BOD-A');
    expect(tree.children.map((c) => c.node.code)).toEqual(['Z1']);
    const e3 = tree.children[0]!.children[0]!;
    expect(e3.node.code).toBe('E3');
    expect(e3.children.map((c) => c.node.code).sort()).toEqual(['B2', 'B3']);
  });

  it('una hoja es un árbol sin hijos', async () => {
    const t = build();
    const w = await aWarehouse(t);
    expect((await t.tree.execute(w.ctx, w.b2.id)).children).toEqual([]);
  });

  // D-29: hiding a deactivated shelf would orphan its active children.
  it('incluye los nodos inactivos, con su active en false (D-29)', async () => {
    const t = build();
    const w = await aWarehouse(t);
    await t.deactivate.execute(w.ctx, w.b3.id);
    const tree = await t.tree.execute(w.ctx, w.e3.id);
    expect(tree.children.map((c) => c.node.code).sort()).toEqual(['B2', 'B3']);
    expect(tree.children.find((c) => c.node.code === 'B3')!.node.active).toBe(false);
  });

  it('un nodo que no existe es 404', async () => {
    const t = build();
    await expect(t.tree.execute(aContext(), 'nope' as NodeId)).rejects.toMatchObject({ type: 'not-found' });
  });

  // D-29: the only read of the module without a cursor needs a ceiling of its own.
  it('un subárbol enorme remite al listado paginado (D-29)', async () => {
    const t = build();
    const w = await aWarehouse(t);
    const many = Array.from({ length: MAX_TREE_NODES + 1 }, (_, i) =>
      aNode({ code: `X${i}` }, w.bodA),
    );
    for (const n of many) await t.nodes.save(n);
    await expect(t.tree.execute(w.ctx, w.bodA.id)).rejects.toMatchObject({
      type: 'tree-too-large',
      status: 422,
    });
  });
});
