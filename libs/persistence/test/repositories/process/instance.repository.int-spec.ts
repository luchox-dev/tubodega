import { v7 } from 'uuid';
import { unwrap, type Cursor, type OrgId, type ProcessInstanceId, type UserId } from '@app/common';
import { Organization, Role, User } from '@app/tenancy';
import { Quantity, type NodeId } from '@app/inventory';
import type { BatchId, ProductId, StorageKey } from '@app/catalog';
import {
  FACTORY_TEMPLATES, ProcessContext, ProcessInstance, ProcessState, ProcessTemplate,
  TemplateCode, type ProcessTemplateId, type StepCompletionId, type StepId,
} from '@app/process';
import {
  KyselyOrganizationRepository, KyselyProcessInstanceRepository, KyselyProcessTemplateRepository,
  ForeignKeyViolationError, KyselyStepCompletionRepository, KyselyUnitOfWork,
  KyselyUserRepository, StepCompletionDao,
} from '@app/persistence';
import { createPersistenceHarness, withRollback } from '../../../../../test/support/db.js';

describe('las instancias de proceso y sus pasos', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  let instances: KyselyProcessInstanceRepository;
  let completions: KyselyStepCompletionRepository;
  let templates: KyselyProcessTemplateRepository;
  let orgs: KyselyOrganizationRepository;
  let users: KyselyUserRepository;
  let uow: KyselyUnitOfWork;

  beforeAll(async () => {
    h = await createPersistenceHarness();
    instances = h.get(KyselyProcessInstanceRepository);
    completions = h.get(KyselyStepCompletionRepository);
    templates = h.get(KyselyProcessTemplateRepository);
    orgs = h.get(KyselyOrganizationRepository);
    users = h.get(KyselyUserRepository);
    uow = h.uow;
  });
  afterAll(() => h.close());

  /** Una organización con su gente y la RECEPCION sembrada: el mínimo que las FK exigen. */
  const mundo = async () => {
    const orgId = v7() as OrgId;
    await orgs.save(unwrap(Organization.create({ id: orgId, name: 'Procesos', slug: `inst-${v7().slice(-12)}` })));
    const actorId = v7() as UserId;
    await users.save(unwrap(User.create({
      id: actorId, orgId, email: `juan-${v7().slice(-12)}@esquina.co`, name: 'Juan',
      passwordHash: 'x'.repeat(20), roles: [Role.OPERATOR],
    })));
    const f = FACTORY_TEMPLATES.find((x) => x.code === 'RECEPCION')!;
    await templates.save(unwrap(ProcessTemplate.create({
      id: v7() as ProcessTemplateId, orgId, code: f.code, version: f.version, steps: f.steps,
    })));
    return { orgId, actorId };
  };

  const abierta = (orgId: OrgId, actorId: UserId, context = ProcessContext.empty()) =>
    ProcessInstance.rehydrate({
      id: v7() as ProcessInstanceId,
      orgId,
      templateCode: unwrap(TemplateCode.of('RECEPCION')),
      templateVersion: 1,
      state: ProcessState.OPEN,
      currentStepId: 'origen' as StepId,
      context,
      actorId,
      version: 1,
    });

  it('guarda una instancia y la relee entera', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const { orgId, actorId } = await mundo();
      const i = abierta(orgId, actorId);
      await instances.save(i);

      const leida = await instances.findById(orgId, i.id);
      expect(leida?.templateCode).toBe('RECEPCION');
      expect(leida?.templateVersion).toBe(1);
      expect(leida?.state).toBe(ProcessState.OPEN);
      expect(leida?.currentStepId).toBe('origen');
      expect(leida?.actorId).toBe(actorId);
      expect(leida?.version).toBe(1);
    });
  });

  /**
   * D-64. Es donde estas cosas se rompen: `values` es un Map, `draft.quantity`
   * es un `Quantity` y hay fechas dentro de los payloads. Un `JSON.stringify`
   * ingenuo los pierde, y el fallo sale al **rehidratar**, media instancia
   * después.
   */
  it('el contexto sobrevive al viaje por jsonb: el Map, el Quantity y las fechas', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const { orgId, actorId } = await mundo();
      const productId = v7() as ProductId;
      const vence = new Date('2026-10-01T00:00:00.000Z');
      const dueAt = new Date('2026-09-26T12:00:00.000Z');

      const context = ProcessContext.empty()
        .with('item' as StepId, { code: '7501000000017', productId })
        .with('lote' as StepId, { lotCode: 'L-NUEVO', expiresAt: vence })
        .with('foto' as StepId, null)
        .withDraft({
          productId,
          quantity: unwrap(Quantity.of('24.500')),
          fromNodeId: v7() as NodeId,
          toNodeId: v7() as NodeId,
          dueAt,
          newBatch: { productId, lotCode: 'L-NUEVO', expiresAt: vence },
        })
        .withStorageKeys(['k1' as StorageKey, 'k2' as StorageKey]);

      const i = abierta(orgId, actorId, context);
      await instances.save(i);

      const c = (await instances.findById(orgId, i.id))!.context;
      expect(c.values.get('item' as StepId)).toEqual({ code: '7501000000017', productId });
      expect(c.values.get('lote' as StepId)).toEqual({ lotCode: 'L-NUEVO', expiresAt: vence });
      // Omitido: la clave está y el valor es null. La diferencia entre «se
      // omitió» y «no existe» es precisamente eso.
      expect(c.values.has('foto' as StepId)).toBe(true);
      expect(c.values.get('foto' as StepId)).toBeNull();
      expect(c.draft.quantity?.toString()).toBe('24.500');
      expect(c.draft.dueAt).toEqual(dueAt);
      expect(c.draft.newBatch?.expiresAt).toEqual(vence);
      expect(c.storageKeys).toEqual(['k1', 'k2']);
    });
  });

  it('el bloqueo optimista es interno, pero es real', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const { orgId, actorId } = await mundo();
      const i = abierta(orgId, actorId);
      await instances.save(i);

      const v2 = await instances.save(i.at('item' as StepId, i.context), 1);
      expect(v2).toBe(2);
      // Quien llegó con la versión vieja no pisa el contexto del que ganó.
      await expect(instances.save(i.at('cantidad' as StepId, i.context), 1)).rejects.toThrow();
    });
  });

  it('P-1: una instancia con una versión de plantilla que no existe no entra', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const { orgId, actorId } = await mundo();
      const huerfana = ProcessInstance.rehydrate({
        id: v7() as ProcessInstanceId, orgId,
        templateCode: unwrap(TemplateCode.of('RECEPCION')), templateVersion: 99,
        state: ProcessState.OPEN, currentStepId: 'origen' as StepId,
        context: ProcessContext.empty(), actorId, version: 1,
      });
      // La clave foránea compuesta es la que convierte P-1 en garantía de base.
      // El 23503 NO se traduce a un error de dominio a propósito: el caso de
      // uso ya comprobó que la versión existe, así que uno que llegue aquí es
      // el dominio dejando pasar algo, y un 500 con traza dice más que un 422
      // inventado.
      await expect(instances.save(huerfana)).rejects.toBeInstanceOf(ForeignKeyViolationError);
    });
  });

  it('un id repetido es process-instance-id-taken, no un 500', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const a = await mundo();
      const b = await mundo();
      const i = abierta(a.orgId, a.actorId);
      await instances.save(i);

      const gemela = ProcessInstance.rehydrate({
        id: i.id, orgId: b.orgId, templateCode: unwrap(TemplateCode.of('RECEPCION')),
        templateVersion: 1, state: ProcessState.OPEN, currentStepId: 'origen' as StepId,
        context: ProcessContext.empty(), actorId: b.actorId, version: 1,
      });
      await expect(instances.save(gemela)).rejects.toMatchObject({ type: 'process-instance-id-taken' });
    });
  });

  it('lista lo último primero, y filtra por estado, plantilla y actor (D-62)', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const { orgId, actorId } = await mundo();
      const primera = abierta(orgId, actorId);
      await instances.save(primera);
      const segunda = abierta(orgId, actorId);
      await instances.save(segunda);
      await instances.save(segunda.completed(segunda.context), 1);

      const page = { limit: 50, sort: { field: 'createdAt', dir: 'desc' } } as const;
      const todas = await instances.list(orgId, {}, page);
      expect(todas.data).toHaveLength(2);
      expect(todas.data[0]?.id).toBe(segunda.id);

      expect((await instances.list(orgId, { state: ProcessState.OPEN }, page)).data).toHaveLength(1);
      expect((await instances.list(orgId, { templateCode: unwrap(TemplateCode.of('RECEPCION')) }, page)).data).toHaveLength(2);
      expect((await instances.list(orgId, { actorId }, page)).data).toHaveLength(2);
      expect((await instances.list(orgId, { actorId: v7() as UserId }, page)).data).toHaveLength(0);
    });
  });

  /**
   * This is also the regression that holds `process_instance.created_at` at
   * `timestamptz(3)` (D-67, D-68), and it is worth saying so out loud because
   * nothing in the shape of the test announces it: what makes it bite is that
   * `withRollback` runs the whole body in **one** transaction, so Postgres
   * hands all five rows the same `now()`. Move a `save` out of it and the
   * timestamps spread apart and the test keeps passing over a broken cursor.
   *
   * With a microsecond column the cursor — an ISO string, which only reaches
   * the millisecond — comes out below the stored value and the second page
   * arrives empty.
   */
  it('pagina por cursor sin saltarse ni repetir, con un solo now() (D-67, D-68)', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const { orgId, actorId } = await mundo();
      const creadas: string[] = [];
      for (let n = 0; n < 5; n += 1) {
        const i = abierta(orgId, actorId);
        await instances.save(i);
        creadas.push(i.id);
      }

      const page = { limit: 2, sort: { field: 'createdAt', dir: 'desc' } } as const;
      const vistas: string[] = [];
      let cursor: Cursor | undefined;
      for (let vuelta = 0; vuelta < 10; vuelta += 1) {
        const p = await instances.list(orgId, {}, { ...page, ...(cursor ? { cursor } : {}) });
        // Without the fix this page came back empty and the walk stopped at 2 of 5.
        expect(p.data.length).toBeGreaterThan(0);
        vistas.push(...p.data.map((i) => i.id));
        if (p.nextCursor === undefined) break;
        cursor = p.nextCursor;
      }
      expect([...vistas].sort()).toEqual([...creadas].sort());
    });
  });

  describe('step_completion', () => {
    const paso = (orgId: OrgId, instanceId: ProcessInstanceId, actorId: UserId, stepId: string, payload: unknown) => ({
      id: v7() as StepCompletionId, orgId, instanceId, stepId: stepId as StepId, actorId,
      payload: payload as never, completedAt: new Date('2026-09-19T10:00:00.000Z'),
    });

    it('guarda el payload enriquecido y lo relee, fechas incluidas', async () => {
      await withRollback(uow, { pool: 'system' }, async () => {
        const { orgId, actorId } = await mundo();
        const i = abierta(orgId, actorId);
        await instances.save(i);
        const vence = new Date('2026-10-01T00:00:00.000Z');
        await completions.append(paso(orgId, i.id, actorId, 'lote', {
          lotCode: 'L-NUEVO', expiresAt: vence, newBatch: { productId: v7(), lotCode: 'L-NUEVO' },
        }));

        const [fila] = await completions.listByInstance(orgId, i.id);
        expect(fila?.stepId).toBe('lote');
        expect(fila?.payload).toMatchObject({ lotCode: 'L-NUEVO', expiresAt: vence });
      });
    });

    it('un paso omitido guarda el null literal de JSON, no un NULL de SQL', async () => {
      await withRollback(uow, { pool: 'system' }, async () => {
        const { orgId, actorId } = await mundo();
        const i = abierta(orgId, actorId);
        await instances.save(i);
        await completions.append(paso(orgId, i.id, actorId, 'foto', null));

        const [fila] = await completions.listByInstance(orgId, i.id);
        // La fila existe, y su payload es null: la diferencia entre «este paso
        // se omitió» y «este paso no existe» es precisamente la fila.
        expect(fila).toBeDefined();
        expect(fila?.payload).toBeNull();
      });
    });

    it('P-3: el mismo paso dos veces choca contra el UNIQUE y sale con su tipo', async () => {
      await withRollback(uow, { pool: 'system' }, async () => {
        const { orgId, actorId } = await mundo();
        const i = abierta(orgId, actorId);
        await instances.save(i);
        await completions.append(paso(orgId, i.id, actorId, 'origen', { nodeId: v7() }));

        await expect(completions.append(paso(orgId, i.id, actorId, 'origen', { nodeId: v7() })))
          .rejects.toMatchObject({ type: 'step-already-completed' });
      });
    });

    it('los devuelve en el orden en que ocurrieron', async () => {
      await withRollback(uow, { pool: 'system' }, async () => {
        const { orgId, actorId } = await mundo();
        const i = abierta(orgId, actorId);
        await instances.save(i);
        for (const [n, s] of ['origen', 'item', 'lote'].entries()) {
          await completions.append({
            ...paso(orgId, i.id, actorId, s, {}),
            completedAt: new Date(Date.UTC(2026, 8, 19, 10, n)),
          });
        }
        expect((await completions.listByInstance(orgId, i.id)).map((c) => c.stepId))
          .toEqual(['origen', 'item', 'lote']);
      });
    });

    /**
     * [08 §8]. La primera de las dos capas de [04 §3.4] es el **tipo**: un DAO
     * de una tabla append-only que heredara `update` tendría el método, y
     * alguien acabaría llamándolo.
     */
    it('el DAO no tiene update, ni upsert, ni delete', () => {
      const dao = h.get(StepCompletionDao) as unknown as Record<string, unknown>;
      expect(dao.create).toBeTypeOf('function');
      expect(dao.update).toBeUndefined();
      expect(dao.upsert).toBeUndefined();
      expect(dao.delete).toBeUndefined();
      // @ts-expect-error append-only: `update` no existe en el tipo (spec 08 §3)
      void h.get(StepCompletionDao).update;
    });
  });
});
