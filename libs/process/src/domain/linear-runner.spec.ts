import { v7 } from 'uuid';
import { err, ok, unwrap, type ProcessInstanceId, type Result, type UserId } from '@app/common';
import { ORG, STEPS_MINIMOS, templateProps } from '../../test/builders/a-template.js';
import { ProcessContext } from './context.js';
import { ProcessInstance, ProcessState } from './instance.js';
import { LinearRunner } from './linear-runner.js';
import { ProcessTemplate } from './template.js';
import { StepHandlerRegistry } from './handlers/registry.js';
import { StepType, type StepPayload } from './step-types.js';
import type { HandlerDeps, StepHandler } from './handlers/handler.js';
import { InvalidStepPayloadError } from './errors.js';
import type { Effect } from './effects.js';
import type { StepId, TemplateCode } from './ids.js';

const ACTOR = '018f0000-0000-7000-8000-0000000000aa' as UserId;
const DEPS = {} as HandlerDeps;

/** Un manejador de mentira que cuenta cuántas veces lo llamaron. */
class Espia implements StepHandler {
  invocaciones = 0;
  constructor(
    readonly type: StepType,
    private readonly veredicto: 'ok' | 'parse' | 'validate' = 'ok',
    private readonly efectos: readonly Effect[] = [],
  ) {}
  parse(raw: unknown): Result<StepPayload> {
    this.invocaciones += 1;
    if (this.veredicto === 'parse') return err(new InvalidStepPayloadError('/x', 'no'));
    return ok(raw as StepPayload);
  }
  validate(payload: StepPayload): Promise<Result<StepPayload>> {
    if (this.veredicto === 'validate') {
      return Promise.resolve(err(new InvalidStepPayloadError('/y', 'tampoco')));
    }
    return Promise.resolve(ok(payload));
  }
  apply(_payload: StepPayload, ctx: ProcessContext): ProcessContext {
    return ctx.withDraft({ reason: `pasó por ${this.type}` });
  }
  effects(): readonly Effect[] {
    return this.efectos;
  }
}

const plantilla = (steps: unknown = STEPS_MINIMOS) =>
  unwrap(ProcessTemplate.create(templateProps({ steps })));

const instancia = (t: ProcessTemplate) =>
  ProcessInstance.start({
    id: v7() as ProcessInstanceId, orgId: ORG,
    templateCode: t.code as TemplateCode, templateVersion: t.version,
    firstStepId: t.firstStep().id, actorId: ACTOR,
  });

const armar = (...handlers: StepHandler[]) => {
  const reg = new StepHandlerRegistry();
  for (const h of handlers) reg.register(h);
  return new LinearRunner(reg);
};

const EFECTO: Effect = { kind: 'EMIT_MOVEMENTS', drafts: [{}] };

describe('LinearRunner.advance', () => {
  it('el camino feliz: avanza al paso siguiente y guarda lo aplicado', async () => {
    const t = plantilla();
    const runner = armar(new Espia(StepType.SCAN_ITEM), new Espia(StepType.CONFIRM));
    const r = await runner.advance({
      instance: instancia(t), template: t, stepId: 'item' as StepId, payload: { code: 'X' }, deps: DEPS,
    });
    expect(r.ok).toBe(true);
    const out = unwrap(r);
    expect(out.instance.currentStepId).toBe('confirmar');
    expect(out.instance.state).toBe(ProcessState.OPEN);
    expect(out.instance.context.values.get('item' as StepId)).toEqual({ code: 'X' });
    expect(out.instance.context.draft.reason).toBe('pasó por SCAN_ITEM');
    expect(out.payload).toEqual({ code: 'X' });
  });

  // P-2: solo se puede completar el paso actual, y el detalle nombra cuál es.
  it('P-2 · un paso que no es el actual es wrong-step, con el actual en el detalle', async () => {
    const t = plantilla();
    const runner = armar(new Espia(StepType.SCAN_ITEM), new Espia(StepType.CONFIRM));
    const r = await runner.advance({
      instance: instancia(t), template: t, stepId: 'confirmar' as StepId, payload: {}, deps: DEPS,
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error.type).toBe('wrong-step');
    expect(!r.ok && r.error.message).toContain('"item"');
  });

  // P-4: una instancia cerrada no admite cambios.
  it('P-4 · una instancia COMPLETED o CANCELLED es instance-closed', async () => {
    const t = plantilla();
    const runner = armar(new Espia(StepType.SCAN_ITEM), new Espia(StepType.CONFIRM));
    const base = instancia(t);
    for (const cerrada of [base.completed(base.context), base.cancelled()]) {
      const r = await runner.advance({
        instance: cerrada, template: t, stepId: 'item' as StepId, payload: { code: 'X' }, deps: DEPS,
      });
      expect(!r.ok && r.error.type).toBe('instance-closed');
    }
  });

  // P-5: un paso required no se puede omitir.
  it('P-5 · omitir un paso required es required-step-skipped', async () => {
    const t = plantilla();
    const espia = new Espia(StepType.SCAN_ITEM);
    const r = await armar(espia, new Espia(StepType.CONFIRM)).advance({
      instance: instancia(t), template: t, stepId: 'item' as StepId, payload: null, deps: DEPS,
    });
    expect(!r.ok && r.error.type).toBe('required-step-skipped');
    expect(espia.invocaciones).toBe(0);
  });

  it('omitir un paso opcional avanza sin invocar al manejador, y lo anota como null', async () => {
    const steps = [
      { id: 'lote', type: 'CAPTURE_BATCH', required: false, transitions: [{ to: 'confirmar' }] },
      { id: 'confirmar', type: 'CONFIRM', required: true, transitions: [{ to: null }] },
    ];
    const t = plantilla(steps);
    const espia = new Espia(StepType.CAPTURE_BATCH);
    const out = unwrap(
      await armar(espia, new Espia(StepType.CONFIRM)).advance({
        instance: instancia(t), template: t, stepId: 'lote' as StepId, payload: null, deps: DEPS,
      }),
    );
    expect(espia.invocaciones).toBe(0);
    expect(out.instance.currentStepId).toBe('confirmar');
    expect(out.instance.context.values.get('lote' as StepId)).toBeNull();
    expect(out.payload).toBeNull();
    expect(out.effects).toEqual([]);
  });

  it('`to: null` deja la instancia COMPLETED y sin paso actual', async () => {
    const t = plantilla();
    const runner = armar(new Espia(StepType.SCAN_ITEM), new Espia(StepType.CONFIRM));
    const media = unwrap(
      await runner.advance({
        instance: instancia(t), template: t, stepId: 'item' as StepId, payload: { code: 'X' }, deps: DEPS,
      }),
    );
    const fin = unwrap(
      await runner.advance({
        instance: media.instance, template: t, stepId: 'confirmar' as StepId, payload: {}, deps: DEPS,
      }),
    );
    expect(fin.instance.state).toBe(ProcessState.COMPLETED);
    expect(fin.instance.currentStepId).toBeUndefined();
  });

  /**
   * P-6, y es la propiedad más visible para quien usa esto: una recepción a
   * medias no ensucia el inventario. El operario puede escanear, irse a comer y
   * volver, y hasta que no confirme, el stock no se ha movido.
   */
  it('P-6 · ningún paso que no cierre el proceso produce efectos', async () => {
    const t = plantilla();
    // El manejador del escaneo declara efectos; el motor no se los pide,
    // porque el paso no cierra nada.
    const runner = armar(
      new Espia(StepType.SCAN_ITEM, 'ok', [EFECTO]),
      new Espia(StepType.CONFIRM, 'ok', [EFECTO]),
    );
    const media = unwrap(
      await runner.advance({
        instance: instancia(t), template: t, stepId: 'item' as StepId, payload: { code: 'X' }, deps: DEPS,
      }),
    );
    expect(media.effects).toEqual([]);

    const fin = unwrap(
      await runner.advance({
        instance: media.instance, template: t, stepId: 'confirmar' as StepId, payload: {}, deps: DEPS,
      }),
    );
    expect(fin.effects).toEqual([EFECTO]);
  });

  it('un manejador sin efectos que cierra el proceso devuelve la lista vacía', async () => {
    const steps = [{ id: 'confirmar', type: 'CONFIRM', required: true, transitions: [{ to: null }] }];
    const t = plantilla(steps);
    const out = unwrap(
      await armar(new Espia(StepType.CONFIRM)).advance({
        instance: instancia(t), template: t, stepId: 'confirmar' as StepId, payload: {}, deps: DEPS,
      }),
    );
    expect(out.effects).toEqual([]);
  });

  it('un tipo de paso sin manejador registrado es unknown-step-type', async () => {
    const t = plantilla();
    const r = await armar(new Espia(StepType.CONFIRM)).advance({
      instance: instancia(t), template: t, stepId: 'item' as StepId, payload: { code: 'X' }, deps: DEPS,
    });
    expect(!r.ok && r.error.type).toBe('unknown-step-type');
  });

  it('lo que el manejador rechaza en parse o en validate sale tal cual', async () => {
    const t = plantilla();
    for (const veredicto of ['parse', 'validate'] as const) {
      const r = await armar(new Espia(StepType.SCAN_ITEM, veredicto), new Espia(StepType.CONFIRM)).advance({
        instance: instancia(t), template: t, stepId: 'item' as StepId, payload: { code: 'X' }, deps: DEPS,
      });
      expect(!r.ok && r.error.type).toBe('invalid-step-payload');
    }
  });

  // No lanza: es dominio, y un Result es lo que la capa de encima sabe traducir.
  it('advance devuelve un Result y no lanza nunca', async () => {
    const t = plantilla();
    const base = instancia(t);
    const r = await armar().advance({
      instance: base.cancelled(), template: t, stepId: 'item' as StepId, payload: null, deps: DEPS,
    });
    expect(r).toHaveProperty('ok', false);
  });
});

describe('LinearRunner.start', () => {
  it('abre la instancia en el primer paso de la plantilla', () => {
    const t = plantilla();
    const id = v7() as ProcessInstanceId;
    const i = armar().start({ id, orgId: ORG, template: t, actorId: ACTOR });
    expect(i.id).toBe(id);
    expect(i.currentStepId).toBe('item');
    expect(i.templateCode).toBe('PRUEBA');
    expect(i.templateVersion).toBe(1);
    expect(i.context.values.size).toBe(0);
  });
});
