import { v7 } from 'uuid';
import type { ProcessInstanceId, UserId } from '@app/common';
import { ORG } from '../../test/builders/a-template.js';
import { ProcessContext } from './context.js';
import { ProcessInstance, ProcessState } from './instance.js';
import type { StepId, TemplateCode } from './ids.js';

const ACTOR = '018f0000-0000-7000-8000-0000000000aa' as UserId;

const abierta = () =>
  ProcessInstance.start({
    id: v7() as ProcessInstanceId,
    orgId: ORG,
    templateCode: 'RECEPCION' as TemplateCode,
    templateVersion: 1,
    firstStepId: 'origen' as StepId,
    actorId: ACTOR,
  });

describe('ProcessInstance', () => {
  it('nace OPEN, en el primer paso, con el contexto vacío y versión 1', () => {
    const i = abierta();
    expect(i.state).toBe(ProcessState.OPEN);
    expect(i.currentStepId).toBe('origen');
    expect(i.context.values.size).toBe(0);
    expect(i.version).toBe(1);
    expect(i.templateVersion).toBe(1);
  });

  it('isOpen() solo mientras lo está', () => {
    const i = abierta();
    expect(i.isOpen()).toBe(true);
    expect(i.completed(i.context).isOpen()).toBe(false);
    expect(i.cancelled().isOpen()).toBe(false);
  });

  // P-2, la mitad de dominio: solo se puede completar el paso actual.
  it('canComplete() es el paso actual y ningún otro', () => {
    const i = abierta();
    expect(i.canComplete('origen' as StepId)).toBe(true);
    expect(i.canComplete('confirmar' as StepId)).toBe(false);
  });

  // P-4, la mitad de dominio: una instancia cerrada no admite cambios.
  it('canComplete() es false en una cerrada, aunque el paso sea el suyo', () => {
    const i = abierta();
    expect(i.completed(i.context).canComplete('origen' as StepId)).toBe(false);
    expect(i.cancelled().canComplete('origen' as StepId)).toBe(false);
  });

  it('`at` avanza al paso siguiente y guarda el contexto, sin cerrar nada', () => {
    const ctx = ProcessContext.empty().with('origen' as StepId, { code: 'X' });
    const i = abierta().at('item' as StepId, ctx);
    expect(i.currentStepId).toBe('item');
    expect(i.state).toBe(ProcessState.OPEN);
    expect(i.context.values.size).toBe(1);
  });

  it('`completed` cierra y deja de tener paso actual', () => {
    const i = abierta().completed(ProcessContext.empty());
    expect(i.state).toBe(ProcessState.COMPLETED);
    expect(i.currentStepId).toBeUndefined();
  });

  it('`cancelled` cierra sin tocar el contexto ni el paso donde se quedó', () => {
    const i = abierta().at('item' as StepId, ProcessContext.empty()).cancelled();
    expect(i.state).toBe(ProcessState.CANCELLED);
    expect(i.currentStepId).toBe('item');
  });

  it('no muta: la instancia anterior sigue abierta y en su paso', () => {
    const a = abierta();
    const b = a.completed(a.context);
    expect(a.state).toBe(ProcessState.OPEN);
    expect(a.currentStepId).toBe('origen');
    expect(b).not.toBe(a);
    expect(b.id).toBe(a.id);
  });

  it('`rehydrate` devuelve lo que la base guardó, versión incluida', () => {
    const id = v7() as ProcessInstanceId;
    const i = ProcessInstance.rehydrate({
      id, orgId: ORG,
      templateCode: 'CUSTODIA' as TemplateCode, templateVersion: 2,
      state: ProcessState.OPEN, currentStepId: 'tenedor' as StepId,
      context: ProcessContext.empty(), actorId: ACTOR, version: 7,
    });
    expect(i.id).toBe(id);
    expect(i.templateVersion).toBe(2);
    expect(i.version).toBe(7);
    expect(i.currentStepId).toBe('tenedor');
  });
});
