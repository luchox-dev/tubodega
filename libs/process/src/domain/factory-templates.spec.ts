import { v7 } from 'uuid';
import { unwrap, type OrgId } from '@app/common';
import { NodeKind } from '@app/inventory';
import { FACTORY_TEMPLATES, FACTORY_TEMPLATE_CODES } from './factory-templates.js';
import { ProcessTemplate } from './template.js';
import { NodeRole, StepType } from './step-types.js';
import type { ProcessTemplateId, StepId } from './ids.js';

const ORG = '018f0000-0000-7000-8000-000000000001' as OrgId;

const armar = (i: number) =>
  unwrap(
    ProcessTemplate.create({
      id: v7() as ProcessTemplateId,
      orgId: ORG,
      code: FACTORY_TEMPLATES[i]!.code,
      version: FACTORY_TEMPLATES[i]!.version,
      steps: FACTORY_TEMPLATES[i]!.steps,
    }),
  );

describe('FACTORY_TEMPLATES', () => {
  it('son seis, con los códigos de [13 §6]', () => {
    expect(FACTORY_TEMPLATE_CODES).toEqual([
      'RECEPCION', 'TRASLADO', 'SALIDA', 'AJUSTE_ENTRADA', 'AJUSTE_SALIDA', 'CUSTODIA',
    ]);
    expect(FACTORY_TEMPLATES.every((t) => t.version === 1)).toBe(true);
  });

  /**
   * Es barata, y es la única que impide sembrar una plantilla rota en cada
   * organización nueva. Sin ella, un `to` mal escrito viaja hasta la instancia
   * de alguien y aparece semanas después como un 500.
   */
  it('las seis pasan el validador', () => {
    for (const t of FACTORY_TEMPLATES) {
      const r = ProcessTemplate.create({
        id: v7() as ProcessTemplateId, orgId: ORG, code: t.code, version: t.version, steps: t.steps,
      });
      expect(r.ok, `${t.code}: ${!r.ok ? r.error.message : ''}`).toBe(true);
    }
  });

  it('las seis terminan en un CONFIRM que cierra con to: null', () => {
    for (let i = 0; i < FACTORY_TEMPLATES.length; i += 1) {
      const t = armar(i);
      const ultimo = t.steps[t.steps.length - 1]!;
      expect(ultimo.id).toBe('confirmar');
      expect(ultimo.type).toBe(StepType.CONFIRM);
      expect(ultimo.transitions).toEqual([{ to: null }]);
    }
  });

  it('RECEPCION es la de [13 §6], paso por paso', () => {
    const t = armar(0);
    expect(t.steps.map((s) => [s.id, s.type, s.required, s.transitions[0]!.to])).toEqual([
      ['origen', StepType.SELECT_NODE, true, 'item'],
      ['item', StepType.SCAN_ITEM, true, 'lote'],
      ['lote', StepType.CAPTURE_BATCH, false, 'cantidad'],
      ['cantidad', StepType.CAPTURE_QTY, true, 'foto'],
      ['foto', StepType.CAPTURE_PHOTO, false, 'destino'],
      ['destino', StepType.SELECT_NODE, true, 'confirmar'],
      ['confirmar', StepType.CONFIRM, true, null],
    ]);
    expect(t.step('origen' as StepId)?.config).toEqual({ role: NodeRole.FROM, allowedKinds: [NodeKind.SOURCE] });
    expect(t.step('destino' as StepId)?.config).toEqual({ role: NodeRole.TO, allowedKinds: [NodeKind.INTERNAL] });
  });

  // La diferencia entre una recepción y un traslado es qué allowedKinds lleva un paso.
  it('lo único que separa RECEPCION de TRASLADO de SALIDA son los allowedKinds', () => {
    const kinds = (i: number, id: string) =>
      (armar(i).step(id as StepId)!.config as { allowedKinds: NodeKind[] }).allowedKinds;
    expect(kinds(0, 'origen')).toEqual([NodeKind.SOURCE]);
    expect(kinds(1, 'origen')).toEqual([NodeKind.INTERNAL]);
    expect(kinds(1, 'destino')).toEqual([NodeKind.INTERNAL]);
    expect(kinds(2, 'destino')).toEqual([NodeKind.TERMINAL]);
    expect(kinds(5, 'tenedor')).toEqual([NodeKind.CUSTODY]);
  });

  it('solo RECEPCION lleva el paso de la foto', () => {
    const conFoto = FACTORY_TEMPLATES.filter((t) => t.steps.some((s) => s.type === StepType.CAPTURE_PHOTO));
    expect(conFoto.map((t) => t.code)).toEqual(['RECEPCION']);
  });

  // D-36: un asiento contra adjustment-in / adjustment-out exige reason en el
  // dominio, así que un `motivo` opcional sería una plantilla que siempre falla.
  it('las dos de ajuste piden el motivo, y fijan su lado por código de nodo', () => {
    const entrada = armar(3);
    const salida = armar(4);
    expect(entrada.step('motivo' as StepId)?.required).toBe(true);
    expect(salida.step('motivo' as StepId)?.required).toBe(true);
    expect(entrada.step('confirmar' as StepId)?.config)
      .toEqual({ defaults: { fromNodeCode: 'adjustment-in' } });
    expect(salida.step('confirmar' as StepId)?.config)
      .toEqual({ defaults: { toNodeCode: 'adjustment-out' } });
    // Un default por uuid sería una plantilla de fábrica que solo vale para una
    // empresa: los ocho nodos de frontera son distintos en cada organización.
    expect(JSON.stringify(FACTORY_TEMPLATES)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it('AJUSTE_ENTRADA no tiene paso origen, y AJUSTE_SALIDA no tiene destino', () => {
    expect(armar(3).step('origen' as StepId)).toBeNull();
    expect(armar(4).step('destino' as StepId)).toBeNull();
  });

  it('CUSTODIA pide la fecha de devolución después del tenedor', () => {
    const t = armar(5);
    expect(t.step('tenedor' as StepId)?.transitions[0]!.to).toBe('vencimiento');
    expect(t.step('vencimiento' as StepId)?.required).toBe(true);
  });

  it('el paso del lote es opcional en las seis: la plantilla no sabe qué producto pasará', () => {
    for (const t of FACTORY_TEMPLATES) {
      expect(t.steps.find((s) => s.id === 'lote')?.required).toBe(false);
    }
  });
});
