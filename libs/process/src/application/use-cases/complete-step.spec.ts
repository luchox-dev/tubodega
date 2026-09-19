import { v7 } from 'uuid';
import { unwrap, type ProcessInstanceId } from '@app/common';
import { InsufficientRoleError, Role } from '@app/tenancy';
import { NodeKind } from '@app/inventory';
import { aContext } from '../../../test/builders/a-context.js';
import { anInstance } from '../../../test/builders/an-instance.js';
import { ORG } from '../../../test/builders/a-template.js';
import { fakeHandlerDeps, unNodo, unProducto } from '../../../test/doubles/fake-handler-deps.js';
import { InMemoryInstanceRepository } from '../../../test/doubles/in-memory-instance.repository.js';
import { InMemoryStepCompletionRepository } from '../../../test/doubles/in-memory-step-completion.repository.js';
import { InMemoryTemplateRepository } from '../../../test/doubles/in-memory-template.repository.js';
import { mvpRegistry } from '../../domain/handlers/index.js';
import { ProcessState } from '../../domain/instance.js';
import { LinearRunner } from '../../domain/linear-runner.js';
import { ProcessTemplate } from '../../domain/template.js';
import type { ProcessTemplateId, StepId } from '../../domain/ids.js';
import { CompleteStep } from './complete-step.js';

const AHORA = new Date('2026-09-19T10:00:00.000Z');

/** TRASLADO en miniatura: origen, item, cantidad, confirmar. */
const PASOS = [
  { id: 'origen', type: 'SELECT_NODE', required: true,
    config: { role: 'FROM', allowedKinds: ['INTERNAL'] }, transitions: [{ to: 'item' }] },
  { id: 'item', type: 'SCAN_ITEM', required: true, transitions: [{ to: 'cantidad' }] },
  { id: 'cantidad', type: 'CAPTURE_QTY', required: true, transitions: [{ to: 'destino' }] },
  { id: 'destino', type: 'SELECT_NODE', required: true,
    config: { role: 'TO', allowedKinds: ['INTERNAL'] }, transitions: [{ to: 'confirmar' }] },
  { id: 'confirmar', type: 'CONFIRM', required: true, transitions: [{ to: null }] },
];

const tornillo = unProducto({ sku: 'TOR-M8' });
const b2 = unNodo('B2', NodeKind.INTERNAL);
const b3 = unNodo('B3', NodeKind.INTERNAL);

const build = () => {
  const instances = new InMemoryInstanceRepository();
  const templates = new InMemoryTemplateRepository();
  const completions = new InMemoryStepCompletionRepository();
  const publicados: string[] = [];
  const efectos: { instanceId: string; kinds: string[] }[] = [];

  const events = { publish: (e: readonly { type: string }[]) => { publicados.push(...e.map((x) => x.type)); return Promise.resolve(); } };
  const ids = { next: () => v7() };
  const deps = { for: () => fakeHandlerDeps({ productos: [tornillo], nodos: [b2, b3], codigos: new Map([['TOR-M8', { product: tornillo }]]), ahora: AHORA }) };
  const applier = {
    apply: (_ctx: unknown, instanceId: string, es: readonly { kind: string }[]) => {
      efectos.push({ instanceId, kinds: es.map((e) => e.kind) });
      return Promise.resolve([{ id: 'mov-1' }]);
    },
  };

  const plantilla = unwrap(ProcessTemplate.create({
    id: v7() as ProcessTemplateId, orgId: ORG, code: 'TRASLADO', version: 1, steps: PASOS,
  }));
  void templates.save(plantilla);

  return {
    instances, templates, completions, publicados, efectos,
    complete: new CompleteStep(
      instances as never, templates as never, completions as never,
      new LinearRunner(mvpRegistry()), deps as never, applier as never,
      events as never, ids as never, { now: () => AHORA },
    ),
  };
};

const abierta = (stepId: string, t: ReturnType<typeof build>) => {
  const i = anInstance({ templateCode: 'TRASLADO', currentStepId: stepId });
  t.instances.sembrar(i);
  return i;
};

const ctx = () => aContext([Role.OPERATOR]);

describe('CompleteStep', () => {
  it('avanza, y devuelve la definición del paso siguiente', async () => {
    const t = build();
    const i = abierta('origen', t);

    const out = await t.complete.execute(ctx(), { instanceId: i.id, stepId: 'origen' as StepId, payload: { nodeId: b2.id } });

    expect(out.instance.currentStepId).toBe('item');
    expect(out.nextStep?.id).toBe('item');
    expect(out.nextStep?.type).toBe('SCAN_ITEM');
    expect(out.movements).toBeUndefined();
  });

  it('escribe el step_completion con el payload **enriquecido** (D-56)', async () => {
    const t = build();
    const i = abierta('item', t);

    await t.complete.execute(ctx(), { instanceId: i.id, stepId: 'item' as StepId, payload: { code: 'TOR-M8' } });

    const fila = t.completions.rows[0];
    expect(fila?.stepId).toBe('item');
    // Lo que `validate` resolvió, no lo que llegó: en la fila queda constancia
    // de qué entendió el motor.
    expect(fila?.payload).toMatchObject({ code: 'TOR-M8', productId: tornillo.id });
  });

  it('un paso omitido guarda el null literal, no la ausencia de fila', async () => {
    const t = build();
    const opcional = unwrap(ProcessTemplate.create({
      id: v7() as ProcessTemplateId, orgId: ORG, code: 'CONOPCIONAL', version: 1,
      steps: [
        { id: 'nota', type: 'CAPTURE_REASON', required: false, transitions: [{ to: 'confirmar' }] },
        { id: 'confirmar', type: 'CONFIRM', required: true, transitions: [{ to: null }] },
      ],
    }));
    await t.templates.save(opcional);
    const i = anInstance({ templateCode: 'CONOPCIONAL', currentStepId: 'nota' });
    t.instances.sembrar(i);

    await t.complete.execute(ctx(), { instanceId: i.id, stepId: 'nota' as StepId, payload: null });

    expect(t.completions.rows[0]?.payload).toBeNull();
  });

  it('P-6: no se aplica ni un efecto antes de CONFIRM', async () => {
    const t = build();
    const i = abierta('origen', t);

    await t.complete.execute(ctx(), { instanceId: i.id, stepId: 'origen' as StepId, payload: { nodeId: b2.id } });
    await t.complete.execute(ctx(), { instanceId: i.id, stepId: 'item' as StepId, payload: { code: 'TOR-M8' } });
    await t.complete.execute(ctx(), { instanceId: i.id, stepId: 'cantidad' as StepId, payload: { quantity: '10' } });

    expect(t.efectos).toEqual([]);
    expect(t.publicados).toEqual(['process.step_completed', 'process.step_completed', 'process.step_completed']);
  });

  it('al confirmar salen los efectos, y la instancia queda COMPLETED', async () => {
    const t = build();
    const i = abierta('origen', t);
    for (const [stepId, payload] of [
      ['origen', { nodeId: b2.id }], ['item', { code: 'TOR-M8' }],
      ['cantidad', { quantity: '10' }], ['destino', { nodeId: b3.id }],
    ] as const) {
      await t.complete.execute(ctx(), { instanceId: i.id, stepId: stepId as StepId, payload });
    }

    const out = await t.complete.execute(ctx(), { instanceId: i.id, stepId: 'confirmar' as StepId, payload: {} });

    expect(out.instance.state).toBe(ProcessState.COMPLETED);
    expect(out.nextStep).toBeUndefined();
    expect(out.movements).toEqual([{ id: 'mov-1' }]);
    expect(t.efectos).toEqual([{ instanceId: i.id, kinds: ['EMIT_MOVEMENTS'] }]);
    expect(t.publicados.at(-1)).toBe('process.completed');
  });

  it('el paso equivocado es 409 wrong-step, y el detalle nombra el actual (P-2)', async () => {
    const t = build();
    const i = abierta('item', t);
    await expect(t.complete.execute(ctx(), { instanceId: i.id, stepId: 'cantidad' as StepId, payload: { quantity: '1' } }))
      .rejects.toMatchObject({ type: 'wrong-step', status: 409, extensions: { currentStepId: 'item' } });
  });

  it('repetir uno ya hecho es step-already-completed, no wrong-step (P-3)', async () => {
    const t = build();
    const i = abierta('origen', t);
    await t.complete.execute(ctx(), { instanceId: i.id, stepId: 'origen' as StepId, payload: { nodeId: b2.id } });

    // Ya quedó atrás: sin la comprobación de P-3 esto sería `wrong-step`, que
    // le diría al cliente que llegó tarde en vez de que ya lo hizo.
    await expect(t.complete.execute(ctx(), { instanceId: i.id, stepId: 'origen' as StepId, payload: { nodeId: b2.id } }))
      .rejects.toMatchObject({ type: 'step-already-completed', status: 409 });
  });

  it('una instancia cerrada es instance-closed, y gana a P-3 (P-4)', async () => {
    const t = build();
    const i = anInstance({ templateCode: 'TRASLADO', state: ProcessState.CANCELLED, currentStepId: 'origen' });
    t.instances.sembrar(i);
    await expect(t.complete.execute(ctx(), { instanceId: i.id, stepId: 'origen' as StepId, payload: { nodeId: b2.id } }))
      .rejects.toMatchObject({ type: 'instance-closed', status: 409 });
  });

  it('un payload que el manejador no sabe leer es invalid-step-payload con puntero', async () => {
    const t = build();
    const i = abierta('cantidad', t);
    await expect(t.complete.execute(ctx(), { instanceId: i.id, stepId: 'cantidad' as StepId, payload: { quantity: '0' } }))
      .rejects.toMatchObject({ type: 'invalid-step-payload', status: 422 });
  });

  it('omitir un paso obligatorio es required-step-skipped (P-5)', async () => {
    const t = build();
    const i = abierta('origen', t);
    await expect(t.complete.execute(ctx(), { instanceId: i.id, stepId: 'origen' as StepId, payload: null }))
      .rejects.toMatchObject({ type: 'required-step-skipped', status: 422 });
  });

  it('la instancia de otra organización no está (I-6)', async () => {
    const t = build();
    await expect(t.complete.execute(ctx(), { instanceId: v7() as ProcessInstanceId, stepId: 'origen' as StepId, payload: null }))
      .rejects.toMatchObject({ type: 'process-instance-not-found', status: 404 });
  });

  it('exige RECORD_MOVEMENT', async () => {
    const t = build();
    const i = abierta('origen', t);
    await expect(t.complete.execute(aContext([Role.VIEWER]), { instanceId: i.id, stepId: 'origen' as StepId, payload: null }))
      .rejects.toBeInstanceOf(InsufficientRoleError);
  });

  /**
   * La FK compuesta `(org_id, code, version)` es la que hace de P-1 una
   * garantía de base, así que solo se llega aquí leyendo una plantilla que
   * alguien borró a mano. Sale con su tipo, no como un 500.
   */
  it('si la versión que la instancia registró no aparece, es template-not-found', async () => {
    const t = build();
    const i = anInstance({ templateCode: 'TRASLADO', templateVersion: 99, currentStepId: 'origen' });
    t.instances.sembrar(i);
    await expect(t.complete.execute(ctx(), { instanceId: i.id, stepId: 'origen' as StepId, payload: { nodeId: b2.id } }))
      .rejects.toMatchObject({ type: 'template-not-found', status: 404 });
  });

  /**
   * Una plantilla que cierra sin `CONFIRM`: no produce efectos, así que la
   * instancia termina sin movimientos y el evento de cierre los lista vacíos.
   * Es el único camino por el que un proceso completa sin asentar nada.
   */
  it('un proceso que cierra sin CONFIRM termina sin movimientos', async () => {
    const t = build();
    const sinConfirmar = unwrap(ProcessTemplate.create({
      id: v7() as ProcessTemplateId, orgId: ORG, code: 'SOLOMIRAR', version: 1,
      steps: [{ id: 'item', type: 'SCAN_ITEM', required: true, transitions: [{ to: null }] }],
    }));
    await t.templates.save(sinConfirmar);
    const i = anInstance({ templateCode: 'SOLOMIRAR', currentStepId: 'item' });
    t.instances.sembrar(i);

    const out = await t.complete.execute(ctx(), { instanceId: i.id, stepId: 'item' as StepId, payload: { code: 'TOR-M8' } });
    expect(out.instance.state).toBe(ProcessState.COMPLETED);
    expect(out.movements).toBeUndefined();
    expect(t.efectos).toEqual([]);
    expect(t.publicados.at(-1)).toBe('process.completed');
  });

  it('resuelve la plantilla en la versión de la instancia, no en la activa (P-1)', async () => {
    const t = build();
    // La v2 quita el paso `origen`; la instancia nació en la v1 y lo sigue viendo.
    await t.templates.save(unwrap(ProcessTemplate.create({
      id: v7() as ProcessTemplateId, orgId: ORG, code: 'TRASLADO', version: 2,
      steps: PASOS.filter((p) => p.id !== 'origen').map((p) => (p.id === 'item' ? p : p)),
    })));
    const i = abierta('origen', t);

    const out = await t.complete.execute(ctx(), { instanceId: i.id, stepId: 'origen' as StepId, payload: { nodeId: b2.id } });
    expect(out.nextStep?.id).toBe('item');
  });
});
