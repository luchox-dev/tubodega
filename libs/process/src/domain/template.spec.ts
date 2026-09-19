import { unwrap } from '@app/common';
import { ORG, STEPS_MINIMOS, conPaso, templateProps } from '../../test/builders/a-template.js';
import { ProcessTemplate } from './template.js';
import { StepType } from './step-types.js';
import type { StepId } from './ids.js';

const falla = (steps: unknown, type: string) => {
  const r = ProcessTemplate.create(templateProps({ steps }));
  expect(r.ok).toBe(false);
  expect(!r.ok && r.error.type).toBe(type);
};

describe('ProcessTemplate.create · lo que acepta', () => {
  it('devuelve la plantilla con sus pasos tipados y activa por defecto', () => {
    const t = unwrap(ProcessTemplate.create(templateProps()));
    expect(t.code).toBe('PRUEBA');
    expect(t.version).toBe(1);
    expect(t.active).toBe(true);
    expect(t.orgId).toBe(ORG);
    expect(t.steps).toHaveLength(2);
    expect(t.steps[0]?.type).toBe(StepType.SCAN_ITEM);
  });

  it('firstStep() es el primero de la lista, no el que se llame de una manera', () => {
    const t = unwrap(ProcessTemplate.create(templateProps()));
    expect(t.firstStep().id).toBe('item');
  });

  it('step(id) devuelve el paso, y null para uno que no está', () => {
    const t = unwrap(ProcessTemplate.create(templateProps()));
    expect(t.step('confirmar' as StepId)?.type).toBe(StepType.CONFIRM);
    expect(t.step('noexiste' as StepId)).toBeNull();
  });

  it('transitionsFrom(id) da las del paso, y vacío para uno que no está', () => {
    const t = unwrap(ProcessTemplate.create(templateProps()));
    expect(t.transitionsFrom('item' as StepId)).toEqual([{ to: 'confirmar' }]);
    expect(t.transitionsFrom('confirmar' as StepId)).toEqual([{ to: null }]);
    expect(t.transitionsFrom('noexiste' as StepId)).toEqual([]);
  });

  it('un paso sin `required` es opcional: lo que no se declara no se exige', () => {
    const t = unwrap(
      ProcessTemplate.create(
        templateProps({
          steps: [{ id: 'confirmar', type: 'CONFIRM', transitions: [{ to: null }] }],
        }),
      ),
    );
    expect(t.steps[0]?.required).toBe(false);
  });

  it('un paso sin `config` lo trae vacío, no indefinido', () => {
    const t = unwrap(ProcessTemplate.create(templateProps()));
    expect(t.steps[0]?.config).toEqual({});
  });

  it('se puede crear inactiva, que es como queda una versión vieja', () => {
    const t = unwrap(ProcessTemplate.create(templateProps({ active: false })));
    expect(t.active).toBe(false);
  });

  it('el código se valida como TemplateCode', () => {
    const r = ProcessTemplate.create(templateProps({ code: 'A'.repeat(65) }));
    expect(!r.ok && r.error.type).toBe('invalid-template-code');
  });
});

describe('ProcessTemplate.create · el validador', () => {
  // P-8. Pasar al workflow es retirar esta comprobación, no rediseñar el modelo.
  it('P-8 · dos transiciones en un paso es branching-not-supported', () => {
    falla(conPaso('item', { transitions: [{ to: 'confirmar' }, { to: 'otro' }] }), 'branching-not-supported');
  });

  it('un `type` que no está en StepType es unknown-step-type', () => {
    falla(conPaso('item', { type: 'INSPECCION_CALIDAD' }), 'unknown-step-type');
    falla(conPaso('item', { type: 42 }), 'unknown-step-type');
  });

  // Los tres de invalid-template: son los que pasan las dos comprobaciones de
  // arriba y se siembran rotos, para aparecer semanas después como un 500.
  it('una transición a un id que no existe es invalid-template', () => {
    falla(conPaso('item', { transitions: [{ to: 'cantidda' }] }), 'invalid-template');
  });

  it('un paso inalcanzable desde el primero es invalid-template', () => {
    falla(
      [...STEPS_MINIMOS, { id: 'huerfano', type: 'CAPTURE_QTY', required: false, transitions: [{ to: null }] }],
      'invalid-template',
    );
  });

  it('una plantilla que no cierra con `to: null` es invalid-template', () => {
    falla(
      [
        { id: 'item', type: 'SCAN_ITEM', required: true, transitions: [{ to: 'confirmar' }] },
        { id: 'confirmar', type: 'CONFIRM', required: true, transitions: [{ to: 'item' }] },
      ],
      'invalid-template',
    );
  });

  // El motor pide los efectos solo al completar (P-6), así que un CONFIRM que
  // no cierre perdería los tres en silencio.
  it('un CONFIRM que no cierra el proceso es invalid-template', () => {
    falla(
      [
        { id: 'confirmar', type: 'CONFIRM', required: true, transitions: [{ to: 'item' }] },
        { id: 'item', type: 'SCAN_ITEM', required: true, transitions: [{ to: null }] },
      ],
      'invalid-template',
    );
  });

  it('un paso sin transiciones es invalid-template: no dice a dónde va', () => {
    falla(conPaso('item', { transitions: [] }), 'invalid-template');
  });

  it('dos pasos con el mismo id son invalid-template', () => {
    falla([...STEPS_MINIMOS, { ...STEPS_MINIMOS[0] }], 'invalid-template');
  });

  it('sin pasos no hay plantilla', () => {
    falla([], 'invalid-template');
    falla('los pasos', 'invalid-template');
    falla(null, 'invalid-template');
  });

  it('un paso que no es un objeto, o sin id, es invalid-template', () => {
    falla(['item'], 'invalid-template');
    falla([{ type: 'CONFIRM', required: true, transitions: [{ to: null }] }], 'invalid-template');
    falla(conPaso('item', { id: '' }), 'invalid-template');
  });

  it('un `required` que no es booleano, o un `config` que no es objeto, es invalid-template', () => {
    falla(conPaso('item', { required: 'sí' }), 'invalid-template');
    falla(conPaso('item', { config: 'role=FROM' }), 'invalid-template');
  });

  it('una transición que no es un objeto con `to`, o un `to` que no es texto ni null', () => {
    falla(conPaso('item', { transitions: 'confirmar' }), 'invalid-template');
    falla(conPaso('item', { transitions: ['confirmar'] }), 'invalid-template');
    falla(conPaso('item', { transitions: [{ to: 7 }] }), 'invalid-template');
  });

  it('el mensaje dice qué está mal, que es lo único que sirve para arreglarlo', () => {
    const r = ProcessTemplate.create(templateProps({ steps: conPaso('item', { transitions: [{ to: 'cantidda' }] }) }));
    expect(!r.ok && r.error.message).toContain('cantidda');
  });
});

describe('desactivar una versión (P-9)', () => {
  it('conserva id, código, versión y pasos, y solo apaga `active`', () => {
    const viva = unwrap(ProcessTemplate.create(templateProps()));
    const muerta = viva.deactivated();

    expect(muerta.active).toBe(false);
    expect(muerta.id).toBe(viva.id);
    expect(muerta.code).toBe(viva.code);
    expect(muerta.version).toBe(viva.version);
    expect(muerta.steps).toEqual(viva.steps);
    // La versión vieja no desaparece: deja de ofrecerse.
    expect(viva.active).toBe(true);
  });
});
