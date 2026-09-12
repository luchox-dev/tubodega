import { v7 } from 'uuid';
import { unwrap, type OrgId } from '@app/common';
import { Organization } from '@app/tenancy';
import {
  FACTORY_TEMPLATES, ProcessTemplate, TemplateCode, type ProcessTemplateId,
} from '@app/process';
import {
  KyselyOrganizationRepository, KyselyProcessTemplateRepository, KyselyUnitOfWork,
} from '@app/persistence';
import { createPersistenceHarness, withRollback } from '../../../../../test/support/db.js';

describe('KyselyProcessTemplateRepository', () => {
  let h: Awaited<ReturnType<typeof createPersistenceHarness>>;
  let templates: KyselyProcessTemplateRepository;
  let orgs: KyselyOrganizationRepository;
  let uow: KyselyUnitOfWork;

  beforeAll(async () => {
    h = await createPersistenceHarness();
    templates = h.get(KyselyProcessTemplateRepository);
    orgs = h.get(KyselyOrganizationRepository);
    uow = h.uow;
  });
  afterAll(() => h.close());

  const newOrg = async (): Promise<OrgId> => {
    const org = unwrap(
      Organization.create({ id: v7() as OrgId, name: 'Procesos', slug: `procesos-${v7().slice(-12)}` }),
    );
    await orgs.save(org);
    return org.id;
  };

  const deFabrica = (orgId: OrgId, i: number, over: Partial<{ version: number; active: boolean }> = {}) => {
    const f = FACTORY_TEMPLATES[i]!;
    return unwrap(
      ProcessTemplate.create({
        id: v7() as ProcessTemplateId,
        orgId,
        code: f.code,
        version: over.version ?? f.version,
        steps: f.steps,
        ...(over.active !== undefined ? { active: over.active } : {}),
      }),
    );
  };

  const code = (raw: string) => unwrap(TemplateCode.of(raw));

  /**
   * El jsonb de ida y vuelta es donde se rompen estas cosas: una plantilla que
   * entra bien y sale con los pasos en otra forma es un 500 en la instancia de
   * alguien, semanas después.
   */
  it('guarda las seis y las relee enteras, pasando el validador', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const orgId = await newOrg();
      for (let i = 0; i < FACTORY_TEMPLATES.length; i += 1) await templates.save(deFabrica(orgId, i));

      const activas = await templates.listActive(orgId);
      expect(activas).toHaveLength(6);

      const recepcion = await templates.findActive(orgId, code('RECEPCION'));
      expect(recepcion).not.toBeNull();
      expect(recepcion!.version).toBe(1);
      expect(recepcion!.steps.map((s) => s.id)).toEqual([
        'origen', 'item', 'lote', 'cantidad', 'foto', 'destino', 'confirmar',
      ]);
      // El config sobrevive al viaje, que es lo que decide de qué tipo es un nodo.
      expect(recepcion!.step('destino' as never)?.config).toEqual({ role: 'TO', allowedKinds: ['INTERNAL'] });
      expect(recepcion!.steps.at(-1)!.transitions).toEqual([{ to: null }]);

      // Y el default de la de ajuste, que es un código y no un uuid.
      const ajuste = await templates.findActive(orgId, code('AJUSTE_ENTRADA'));
      expect(ajuste!.step('confirmar' as never)?.config).toEqual({
        defaults: { fromNodeCode: 'adjustment-in' },
      });
    });
  });

  it('listActive ordena por código, y deja fuera las inactivas', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const orgId = await newOrg();
      await templates.save(deFabrica(orgId, 1));
      await templates.save(deFabrica(orgId, 0));
      await templates.save(deFabrica(orgId, 2, { active: false }));

      expect((await templates.listActive(orgId)).map((t) => t.code)).toEqual(['RECEPCION', 'TRASLADO']);
      expect(await templates.findActive(orgId, code('SALIDA'))).toBeNull();
      // Pero sigue ahí, que es de lo que trata versionar.
      expect(await templates.findVersion(orgId, code('SALIDA'), 1)).not.toBeNull();
    });
  });

  it('findVersion distingue versiones, y findActive devuelve la activa', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const orgId = await newOrg();
      await templates.save(deFabrica(orgId, 0, { version: 1, active: false }));
      await templates.save(deFabrica(orgId, 0, { version: 2 }));

      expect((await templates.findVersion(orgId, code('RECEPCION'), 1))!.active).toBe(false);
      expect((await templates.findActive(orgId, code('RECEPCION')))!.version).toBe(2);
      expect(await templates.findVersion(orgId, code('RECEPCION'), 9)).toBeNull();
    });
  });

  /**
   * La trampa del DAO: `version` es parte de la clave natural, no el bloqueo
   * optimista. Con `versioned = true` este guardado haría `version + 1` sobre
   * una columna que significa otra cosa, y fallaría además por un `updated_at`
   * que esta tabla no tiene.
   */
  it('reescribir una plantilla no le toca el número de versión', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const orgId = await newOrg();
      const t = deFabrica(orgId, 0, { version: 3 });
      await templates.save(t);
      await templates.save(t);
      await templates.save(t);

      const leida = await templates.findVersion(orgId, code('RECEPCION'), 3);
      expect(leida!.version).toBe(3);
      expect(leida!.id).toBe(t.id);
      expect(await templates.listActive(orgId)).toHaveLength(1);
    });
  });

  // P-9. Sin instancias todavía —las escribe el plan 8—, pero la consulta tiene
  // que correr de verdad contra la tabla, que es lo que esto comprueba.
  it('hasInstances dice que no cuando no las hay', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const orgId = await newOrg();
      await templates.save(deFabrica(orgId, 0));
      expect(await templates.hasInstances(orgId, code('RECEPCION'), 1)).toBe(false);
    });
  });

  it('una organización no ve las plantillas de la de al lado (I-6)', async () => {
    await withRollback(uow, { pool: 'system' }, async () => {
      const mia = await newOrg();
      const suya = await newOrg();
      await templates.save(deFabrica(mia, 0));

      expect(await templates.listActive(suya)).toEqual([]);
      expect(await templates.findActive(suya, code('RECEPCION'))).toBeNull();
    });
  });
});
