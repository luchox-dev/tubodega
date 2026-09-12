import { unwrap, type OrgId } from '@app/common';
import { CustomEntity, CustomFieldDefinition, CustomType, type CustomFieldId } from '@app/catalog';
import { aNode } from '../../test/builders/a-node.js';
import { Node, NodeKind } from './node.js';
import type { NodeId } from './ids.js';

const ORG = '018f0000-0000-7000-8000-000000000001' as OrgId;

describe('Node · construcción y path', () => {
  it('el path de una raíz es su código', () => {
    expect(aNode({ code: 'BOD-A' }).path).toBe('BOD-A');
  });

  it('el path de un hijo cuelga del padre', () => {
    const bodA = aNode({ code: 'BOD-A' });
    const z1 = aNode({ code: 'Z1' }, bodA);
    const e3 = aNode({ code: 'E3' }, z1);
    expect(e3.path).toBe('BOD-A/Z1/E3');
    expect(e3.parentId).toBe(z1.id);
  });

  it('nace activo y en la versión 1', () => {
    const n = aNode();
    expect(n.active).toBe(true);
    expect(n.version).toBe(1);
  });

  it('un código inválido no construye un nodo', () => {
    const r = Node.create({ id: 'x' as NodeId, orgId: ORG, kind: NodeKind.INTERNAL, code: 'a/b', name: 'Malo' });
    expect(r.ok).toBe(false);
  });

  it('el nombre se recorta', () => {
    expect(aNode({ name: '  Zona 1  ' }).name).toBe('Zona 1');
  });

  it('un campo propio inválido tampoco construye un nodo (C-7)', () => {
    const def = unwrap(
      CustomFieldDefinition.create({
        id: 'd' as CustomFieldId,
        orgId: ORG,
        entity: CustomEntity.NODE,
        key: 'responsable',
        label: 'Responsable',
        type: CustomType.TEXT,
      }),
    );
    const r = Node.create(
      { id: 'x' as NodeId, orgId: ORG, kind: NodeKind.INTERNAL, code: 'Z1', name: 'Zona', customFields: { responsable: 42 } },
      undefined,
      [def],
    );
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.type).toBe('invalid-custom-field');
  });
});

describe('Node · los predicados de [12 §2]', () => {
  it.each([
    [NodeKind.INTERNAL, true, false],
    [NodeKind.CUSTODY, true, false],
    [NodeKind.TERMINAL, false, true],
    [NodeKind.SOURCE, false, true],
  ])('%s: custodiable=%s frontera=%s', (kind, custodial, boundary) => {
    const n = aNode({ kind });
    expect(n.isCustodial()).toBe(custodial);
    expect(n.isBoundary()).toBe(boundary);
  });

  it('solo un nodo activo admite movimientos (I-16)', () => {
    const n = aNode();
    expect(n.canReceiveMovements()).toBe(true);
    expect(n.deactivate().canReceiveMovements()).toBe(false);
  });
});

describe('Node · isDescendantOf', () => {
  const bodA = aNode({ code: 'BOD-A' });
  const z1 = aNode({ code: 'Z1' }, bodA);
  const e3 = aNode({ code: 'E3' }, z1);

  it('un nieto es descendiente del abuelo', () => {
    expect(e3.isDescendantOf(bodA)).toBe(true);
    expect(e3.isDescendantOf(z1)).toBe(true);
  });

  it('el ancestro no es descendiente del nieto', () => {
    expect(bodA.isDescendantOf(e3)).toBe(false);
  });

  it('un nodo no es descendiente de sí mismo', () => {
    expect(z1.isDescendantOf(z1)).toBe(false);
  });

  // The trap this whole module is built around: a prefix is not an ancestor.
  it('«BOD-A/Z1» no es ancestro de «BOD-A/Z10»', () => {
    const z10 = aNode({ code: 'Z10' }, bodA);
    expect(z10.isDescendantOf(z1)).toBe(false);
    expect(z10.isDescendantOf(bodA)).toBe(true);
  });

  it('dos organizaciones no se emparentan aunque el path coincida', () => {
    const otra = aNode({ code: 'Z1', orgId: '018f0000-0000-7000-8000-000000000002' as OrgId }, bodA);
    expect(otra.isDescendantOf(bodA)).toBe(false);
  });
});

describe('Node · moveTo', () => {
  const bodA = aNode({ code: 'BOD-A' });
  const bodB = aNode({ code: 'BOD-B' });

  it('recalcula el path bajo el padre nuevo', () => {
    const z1 = aNode({ code: 'Z1' }, bodA);
    const moved = z1.moveTo(bodB);
    expect(moved.path).toBe('BOD-B/Z1');
    expect(moved.parentId).toBe(bodB.id);
  });

  it('mover a la raíz deja el path en el código', () => {
    const z1 = aNode({ code: 'Z1' }, bodA);
    const moved = z1.moveTo(undefined);
    expect(moved.path).toBe('Z1');
    expect(moved.parentId).toBeUndefined();
  });

  it('no cambia el código ni el tipo', () => {
    const z1 = aNode({ code: 'Z1' }, bodA);
    const moved = z1.moveTo(bodB);
    expect(moved.code).toBe('Z1');
    expect(moved.kind).toBe(z1.kind);
    expect(moved.id).toBe(z1.id);
  });
});

describe('Node · update y deactivate', () => {
  it('cambia el nombre y deja lo demás quieto', () => {
    const n = aNode({ code: 'Z1', name: 'Zona 1' });
    const next = unwrap(n.update({ name: 'Zona fría' }));
    expect(next.name).toBe('Zona fría');
    expect(next.code).toBe('Z1');
    expect(next.path).toBe(n.path);
  });

  it('sin cambios devuelve lo mismo', () => {
    const n = aNode();
    expect(unwrap(n.update({})).name).toBe(n.name);
  });

  it('valida los campos propios contra las definiciones de NODE (C-7)', () => {
    const def = unwrap(
      CustomFieldDefinition.create({
        id: 'd' as CustomFieldId,
        orgId: ORG,
        entity: CustomEntity.NODE,
        key: 'responsable',
        label: 'Responsable',
        type: CustomType.TEXT,
      }),
    );
    const ok = unwrap(aNode().update({ customFields: { responsable: 'Juan' } }, [def]));
    expect(ok.customFields.toJSON()).toEqual({ responsable: 'Juan' });

    const bad = aNode().update({ customFields: { responsable: 42 } }, [def]);
    expect(bad.ok).toBe(false);
  });

  it('desactivar es idempotente en el valor', () => {
    const n = aNode().deactivate();
    expect(n.active).toBe(false);
    expect(n.deactivate().active).toBe(false);
  });

  it('rehydrate devuelve lo que guardó', () => {
    const n = aNode({ code: 'Z1' });
    const back = Node.rehydrate({
      id: n.id, orgId: n.orgId, kind: n.kind, code: n.code, name: n.name,
      path: n.path, active: false, customFields: n.customFields, version: 7,
    });
    expect(back.version).toBe(7);
    expect(back.active).toBe(false);
    expect(back.parentId).toBeUndefined();
  });
});
