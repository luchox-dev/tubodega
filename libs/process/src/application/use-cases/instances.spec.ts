import { v7 } from 'uuid';
import { unwrap, type Cursor, type OrgId, type ProcessInstanceId, type UserId } from '@app/common';
import { InsufficientRoleError, Role } from '@app/tenancy';
import { aContext } from '../../../test/builders/a-context.js';
import { anInstance, JUAN } from '../../../test/builders/an-instance.js';
import { ORG, STEPS_MINIMOS, templateProps } from '../../../test/builders/a-template.js';
import { InMemoryInstanceRepository } from '../../../test/doubles/in-memory-instance.repository.js';
import { InMemoryStepCompletionRepository } from '../../../test/doubles/in-memory-step-completion.repository.js';
import { InMemoryTemplateRepository } from '../../../test/doubles/in-memory-template.repository.js';
import { ProcessState } from '../../domain/instance.js';
import { ProcessTemplate } from '../../domain/template.js';
import { LinearRunner } from '../../domain/linear-runner.js';
import { mvpRegistry } from '../../domain/handlers/index.js';
import type { ProcessTemplateId, StepId, TemplateCode } from '../../domain/ids.js';
import { CancelProcess } from './cancel-process.js';
import { GetProcessInstance } from './get-process-instance.js';
import { ListProcessInstances } from './list-process-instances.js';
import { StartProcess } from './start-process.js';

const OTRA = '018f0000-0000-7000-8000-0000000000ff' as OrgId;

class IdsFijos {
  private n = 0;
  next(): string { this.n += 1; return `018f0000-0000-7000-8000-00000000${String(this.n).padStart(4, '0')}`; }
}

class EventosEnMemoria {
  readonly publicados: { type: string; data: Record<string, unknown> }[] = [];
  publish(events: readonly { type: string; data: Readonly<Record<string, unknown>> }[]): Promise<void> {
    this.publicados.push(...events.map((e) => ({ type: e.type, data: { ...e.data } })));
    return Promise.resolve();
  }
}

const RELOJ = { now: () => new Date('2026-09-19T10:00:00.000Z') };

const build = () => {
  const instances = new InMemoryInstanceRepository();
  const templates = new InMemoryTemplateRepository();
  const completions = new InMemoryStepCompletionRepository();
  const events = new EventosEnMemoria();
  const ids = new IdsFijos();
  const runner = new LinearRunner(mvpRegistry());
  return {
    instances, templates, completions, events,
    start: new StartProcess(instances as never, templates as never, runner, events as never, ids as never, RELOJ),
    cancel: new CancelProcess(instances as never, events as never, ids as never, RELOJ),
    get: new GetProcessInstance(instances as never, templates as never, completions as never),
    list: new ListProcessInstances(instances as never),
  };
};

const plantilla = (over: Partial<{ orgId: OrgId; code: string; version: number; active: boolean }> = {}) =>
  unwrap(ProcessTemplate.create(templateProps({ ...over, steps: STEPS_MINIMOS }) as never));

const sembrarPlantilla = async (t: ReturnType<typeof build>, over = {}) => {
  const p = plantilla(over);
  await t.templates.save(p);
  return p;
};

describe('StartProcess', () => {
  it('abre la instancia en el primer paso, y devuelve su definición', async () => {
    const t = build();
    await sembrarPlantilla(t);

    const out = await t.start.execute(aContext([Role.OPERATOR]), { templateCode: 'PRUEBA' });

    expect(out.instance.state).toBe(ProcessState.OPEN);
    expect(out.instance.templateCode).toBe('PRUEBA');
    expect(out.instance.templateVersion).toBe(1);
    expect(out.nextStep.id).toBe('item');
    expect(t.instances.rows.size).toBe(1);
  });

  it('el actor es quien abre, no quien se diga', async () => {
    const t = build();
    await sembrarPlantilla(t);
    const ctx = aContext([Role.OPERATOR]);

    const out = await t.start.execute(ctx, { templateCode: 'PRUEBA' });
    expect(out.instance.actorId).toBe(ctx.userId);
  });

  it('acepta el id del cliente, y si no lo trae lo acuña', async () => {
    const t = build();
    await sembrarPlantilla(t);
    const mio = v7() as ProcessInstanceId;

    const conId = await t.start.execute(aContext([Role.OPERATOR]), { templateCode: 'PRUEBA', id: mio });
    expect(conId.instance.id).toBe(mio);

    const sinId = await t.start.execute(aContext([Role.OPERATOR]), { templateCode: 'PRUEBA' });
    expect(sinId.instance.id).not.toBe(mio);
  });

  it('un código sin versión activa es 404 template-not-found', async () => {
    const t = build();
    await sembrarPlantilla(t, { active: false });
    await expect(t.start.execute(aContext([Role.OPERATOR]), { templateCode: 'PRUEBA' }))
      .rejects.toMatchObject({ type: 'template-not-found', status: 404 });
  });

  it('un código que no cabe en la columna también es 404, no 422', async () => {
    const t = build();
    await expect(t.start.execute(aContext([Role.OPERATOR]), { templateCode: 'x'.repeat(65) }))
      .rejects.toMatchObject({ type: 'template-not-found' });
  });

  it('exige RECORD_MOVEMENT: Sofía solo mira', async () => {
    const t = build();
    await sembrarPlantilla(t);
    await expect(t.start.execute(aContext([Role.VIEWER]), { templateCode: 'PRUEBA' }))
      .rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it('publica process.started', async () => {
    const t = build();
    await sembrarPlantilla(t);
    const out = await t.start.execute(aContext([Role.OPERATOR]), { templateCode: 'PRUEBA' });
    expect(t.events.publicados).toEqual([
      { type: 'process.started', data: { instanceId: out.instance.id, templateCode: 'PRUEBA', templateVersion: 1 } },
    ]);
  });
});

describe('CancelProcess', () => {
  it('cierra la instancia y no toca nada más (P-6)', async () => {
    const t = build();
    const abierta = anInstance();
    t.instances.sembrar(abierta);

    const out = await t.cancel.execute(aContext([Role.OPERATOR]), abierta.id);

    expect(out.state).toBe(ProcessState.CANCELLED);
    // Dónde se abandonó es parte de lo que pasó.
    expect(out.currentStepId).toBe('item');
    expect(t.instances.rows.get(abierta.id)?.instance.state).toBe(ProcessState.CANCELLED);
  });

  it('una instancia cerrada es 409 instance-closed (P-4)', async () => {
    const t = build();
    const cerrada = anInstance({ state: ProcessState.COMPLETED, currentStepId: undefined });
    t.instances.sembrar(cerrada);
    await expect(t.cancel.execute(aContext([Role.OPERATOR]), cerrada.id))
      .rejects.toMatchObject({ type: 'instance-closed', status: 409 });
  });

  it('la de otra organización no está, y nunca es 403 (I-6)', async () => {
    const t = build();
    const ajena = anInstance({ orgId: OTRA });
    t.instances.sembrar(ajena);
    await expect(t.cancel.execute(aContext([Role.OPERATOR]), ajena.id))
      .rejects.toMatchObject({ type: 'process-instance-not-found', status: 404 });
  });

  it('publica process.cancelled', async () => {
    const t = build();
    const abierta = anInstance();
    t.instances.sembrar(abierta);
    await t.cancel.execute(aContext([Role.OPERATOR]), abierta.id);
    expect(t.events.publicados.map((e) => e.type)).toEqual(['process.cancelled']);
  });
});

describe('GetProcessInstance', () => {
  it('trae los completados y, si sigue abierta, la definición del paso actual (D-63)', async () => {
    const t = build();
    await sembrarPlantilla(t);
    const abierta = anInstance();
    t.instances.sembrar(abierta);
    await t.completions.append({
      id: v7() as never, orgId: ORG, instanceId: abierta.id, stepId: 'item' as StepId,
      actorId: JUAN, payload: null, completedAt: new Date('2026-09-19T09:00:00.000Z'),
    });

    const out = await t.get.execute(aContext(), abierta.id);

    expect(out.instance.id).toBe(abierta.id);
    expect(out.completions).toHaveLength(1);
    expect(out.currentStep?.id).toBe('item');
  });

  it('una cerrada no tiene paso actual que enseñar', async () => {
    const t = build();
    await sembrarPlantilla(t);
    const cerrada = anInstance({ state: ProcessState.COMPLETED, currentStepId: undefined });
    t.instances.sembrar(cerrada);

    const out = await t.get.execute(aContext(), cerrada.id);
    expect(out.currentStep).toBeUndefined();
  });

  it('resuelve la plantilla en la versión que la instancia registró (P-1)', async () => {
    const t = build();
    await sembrarPlantilla(t, { version: 1 });
    // La v2 existe y es la activa, pero la instancia nació en la v1.
    const v2 = unwrap(ProcessTemplate.create({
      id: v7() as ProcessTemplateId, orgId: ORG, code: 'PRUEBA', version: 2,
      steps: [{ id: 'otro', type: 'SCAN_ITEM', required: true, transitions: [{ to: 'confirmar' }] },
              { id: 'confirmar', type: 'CONFIRM', required: true, transitions: [{ to: null }] }],
    }));
    await t.templates.save(v2);

    const abierta = anInstance({ templateVersion: 1 });
    t.instances.sembrar(abierta);

    const out = await t.get.execute(aContext(), abierta.id);
    expect(out.currentStep?.id).toBe('item');
  });

  it('la de otra organización no está (I-6)', async () => {
    const t = build();
    t.instances.sembrar(anInstance({ orgId: OTRA }));
    await expect(t.get.execute(aContext(), [...t.instances.rows.keys()][0] as ProcessInstanceId))
      .rejects.toMatchObject({ type: 'process-instance-not-found', status: 404 });
  });

  it('exige READ', async () => {
    const t = build();
    const abierta = anInstance();
    t.instances.sembrar(abierta);
    const sinRol = { ...aContext(), roles: new Set<Role>() };
    await expect(t.get.execute(sinRol, abierta.id)).rejects.toBeInstanceOf(InsufficientRoleError);
  });
});

describe('ListProcessInstances', () => {
  const tres = (t: ReturnType<typeof build>) => {
    t.instances.sembrar(anInstance({ state: ProcessState.OPEN, templateCode: 'RECEPCION' }));
    t.instances.sembrar(anInstance({ state: ProcessState.COMPLETED, templateCode: 'RECEPCION', currentStepId: undefined }));
    t.instances.sembrar(anInstance({ state: ProcessState.OPEN, templateCode: 'SALIDA', actorId: '018f0000-0000-7000-8000-0000000000b2' as UserId }));
  };
  const page = { limit: 50, sort: { field: 'createdAt', dir: 'desc' } } as const;

  it('lo último primero, que es lo que quiere quien abre la bandeja (D-62)', async () => {
    const t = build();
    tres(t);
    const found = await t.list.execute(aContext(), {}, page);
    expect(found.data.map((i) => i.templateCode)).toEqual(['SALIDA', 'RECEPCION', 'RECEPCION']);
  });

  it('filtra por estado, por plantilla y por actor', async () => {
    const t = build();
    tres(t);
    expect((await t.list.execute(aContext(), { state: ProcessState.OPEN }, page)).data).toHaveLength(2);
    expect((await t.list.execute(aContext(), { templateCode: 'RECEPCION' as TemplateCode }, page)).data).toHaveLength(2);
    expect((await t.list.execute(aContext(), { actorId: JUAN }, page)).data).toHaveLength(2);
  });

  it('no enseña las de otra organización (I-6)', async () => {
    const t = build();
    tres(t);
    t.instances.sembrar(anInstance({ orgId: OTRA }));
    expect((await t.list.execute(aContext(), {}, page)).data).toHaveLength(3);
  });

  it('pagina por cursor', async () => {
    const t = build();
    tres(t);
    const primera = await t.list.execute(aContext(), {}, { ...page, limit: 2 });
    expect(primera.data).toHaveLength(2);
    expect(primera.hasMore).toBe(true);

    const segunda = await t.list.execute(aContext(), {}, { ...page, limit: 2, cursor: primera.nextCursor as Cursor });
    expect(segunda.data).toHaveLength(1);
    expect(segunda.hasMore).toBe(false);
  });

  it('exige READ', async () => {
    const t = build();
    const sinRol = { ...aContext(), roles: new Set<Role>() };
    await expect(t.list.execute(sinRol, {}, page)).rejects.toBeInstanceOf(InsufficientRoleError);
  });
});
