import { v7 } from 'uuid';
import { unwrap } from '@app/common';
import { InsufficientRoleError, Role } from '@app/tenancy';
import { aContext } from '../../../test/builders/a-context.js';
import { ORG, STEPS_MINIMOS } from '../../../test/builders/a-template.js';
import { InMemoryTemplateRepository } from '../../../test/doubles/in-memory-template.repository.js';
import { ProcessTemplate } from '../../domain/template.js';
import type { ProcessTemplateId, TemplateCode } from '../../domain/ids.js';
import { CreateTemplateVersion } from './create-template-version.js';

const build = () => {
  const repo = new InMemoryTemplateRepository();
  const ids = { next: () => v7() };
  void repo.save(unwrap(ProcessTemplate.create({
    id: v7() as ProcessTemplateId, orgId: ORG, code: 'RECEPCION', version: 1, steps: STEPS_MINIMOS,
  })));
  return { repo, crear: new CreateTemplateVersion(repo, ids as never) };
};

const SIN_FOTO = [
  { id: 'item', type: 'SCAN_ITEM', required: true, transitions: [{ to: 'confirmar' }] },
  { id: 'confirmar', type: 'CONFIRM', required: true, transitions: [{ to: null }] },
];

const admin = () => aContext([Role.ADMIN]);

describe('CreateTemplateVersion', () => {
  it('crea la versión nueva y desactiva la anterior, sin tocarla (P-9)', async () => {
    const t = build();

    const v2 = await t.crear.execute(admin(), { code: 'RECEPCION', version: 2, steps: SIN_FOTO });

    expect(v2.version).toBe(2);
    expect(v2.active).toBe(true);
    // La v1 sigue existiendo: una recepción de marzo se audita con las reglas
    // de marzo. Lo que deja de ser es ofrecible.
    const v1 = await t.repo.findVersion(ORG, 'RECEPCION' as TemplateCode, 1);
    expect(v1).not.toBeNull();
    expect(v1?.active).toBe(false);
    expect(v1?.steps).toHaveLength(2);
  });

  it('la activa pasa a ser la nueva', async () => {
    const t = build();
    await t.crear.execute(admin(), { code: 'RECEPCION', version: 2, steps: SIN_FOTO });
    expect((await t.repo.findActive(ORG, 'RECEPCION' as TemplateCode))?.version).toBe(2);
  });

  it('una versión que ya existe es 409 template-version-taken (D-61)', async () => {
    const t = build();
    await expect(t.crear.execute(admin(), { code: 'RECEPCION', version: 1, steps: SIN_FOTO }))
      .rejects.toMatchObject({ type: 'template-version-taken', status: 409 });
  });

  it('una versión que no supera a la activa es 422 invalid-template', async () => {
    const t = build();
    await t.crear.execute(admin(), { code: 'RECEPCION', version: 5, steps: SIN_FOTO });
    // La 3 no existe, pero iría por detrás de la activa: activarla sería
    // retroceder, no versionar.
    await expect(t.crear.execute(admin(), { code: 'RECEPCION', version: 3, steps: SIN_FOTO }))
      .rejects.toMatchObject({ type: 'invalid-template', status: 422 });
  });

  it('hereda el validador: dos transiciones son branching-not-supported (P-8)', async () => {
    const t = build();
    await expect(t.crear.execute(admin(), {
      code: 'RECEPCION', version: 2,
      steps: [
        { id: 'item', type: 'SCAN_ITEM', required: true, transitions: [{ to: 'confirmar' }, { to: null }] },
        { id: 'confirmar', type: 'CONFIRM', required: true, transitions: [{ to: null }] },
      ],
    })).rejects.toMatchObject({ type: 'branching-not-supported', status: 422 });
  });

  it('hereda el validador: un tipo desconocido es unknown-step-type', async () => {
    const t = build();
    await expect(t.crear.execute(admin(), {
      code: 'RECEPCION', version: 2,
      steps: [{ id: 'raro', type: 'INSPECCION_CALIDAD', required: true, transitions: [{ to: null }] }],
    })).rejects.toMatchObject({ type: 'unknown-step-type', status: 422 });
  });

  it('hereda el validador: una transición a un paso que no existe es invalid-template', async () => {
    const t = build();
    await expect(t.crear.execute(admin(), {
      code: 'RECEPCION', version: 2,
      steps: [
        { id: 'item', type: 'SCAN_ITEM', required: true, transitions: [{ to: 'confirmaar' }] },
        { id: 'confirmar', type: 'CONFIRM', required: true, transitions: [{ to: null }] },
      ],
    })).rejects.toMatchObject({ type: 'invalid-template', status: 422 });
  });

  it('un código sin versión activa es 404: se versiona lo que se puede ver', async () => {
    const t = build();
    await expect(t.crear.execute(admin(), { code: 'NOEXISTE', version: 2, steps: SIN_FOTO }))
      .rejects.toMatchObject({ type: 'template-not-found', status: 404 });
  });

  it('un código imposible es 404, no un 422 sobre el ancho de una columna', async () => {
    const t = build();
    await expect(t.crear.execute(admin(), { code: 'x'.repeat(65), version: 2, steps: SIN_FOTO }))
      .rejects.toMatchObject({ type: 'template-not-found', status: 404 });
  });

  it('una versión que no es entera tampoco avanza', async () => {
    const t = build();
    await expect(t.crear.execute(admin(), { code: 'RECEPCION', version: 1.5, steps: SIN_FOTO }))
      .rejects.toMatchObject({ type: 'invalid-template', status: 422 });
  });

  it('exige MANAGE_CATALOG: Juan opera procesos y no los redefine', async () => {
    const t = build();
    await expect(t.crear.execute(aContext([Role.OPERATOR]), { code: 'RECEPCION', version: 2, steps: SIN_FOTO }))
      .rejects.toBeInstanceOf(InsufficientRoleError);
  });

  it('no toca las plantillas de otra organización', async () => {
    const t = build();
    await t.crear.execute(admin(), { code: 'RECEPCION', version: 2, steps: SIN_FOTO });
    expect(t.repo.rows.every((p) => p.orgId === ORG)).toBe(true);
  });
});

/**
 * Publicar una versión no puede depender de que la que está en servicio se
 * pueda construir. La guarda que exige que una plantilla termine en un CONFIRM
 * obligatorio corre también al leer —`parseSteps` se re-evalúa en cada lectura,
 * a propósito— así que una organización que hubiera publicado una plantilla
 * inválida antes de la guarda se quedaba sin leerla y, si publicar la cargaba,
 * sin poder sustituirla tampoco: atascada para siempre.
 *
 * El caso de uso pregunta por el NÚMERO de la activa, que es una columna. Aquí
 * se comprueba que basta con eso.
 */
describe('CreateTemplateVersion · salir de una plantilla que ya no se puede construir', () => {
  it('publica una versión sana sin necesitar parsear la activa', async () => {
    const repo = new InMemoryTemplateRepository();
    const ids = { next: () => v7() };
    const crear = new CreateTemplateVersion(repo, ids as never);

    // Una fila como las que dejó el defecto: cierra sin CONFIRM. Se siembra
    // saltándose el constructor, que es exactamente como llegó a la tabla.
    const rota = {
      id: v7() as ProcessTemplateId,
      orgId: ORG,
      code: 'TRASLADO' as TemplateCode,
      version: 4,
      active: true,
      steps: [{ id: 'item', type: 'SCAN_ITEM', required: true, config: {}, transitions: [{ to: null }] }],
      deactivated() {
        throw new Error('no se debería construir la rota para publicar encima');
      },
    } as unknown as ProcessTemplate;
    repo.rows.push(rota);

    const v5 = await crear.execute(admin(), { code: 'TRASLADO', version: 5, steps: SIN_FOTO });

    expect(v5.version).toBe(5);
    expect(v5.active).toBe(true);
    // Y la rota queda fuera de servicio, así que el listado vuelve a leerse.
    expect(await repo.listActive(ORG)).toHaveLength(1);
    expect((await repo.listActive(ORG))[0]?.version).toBe(5);
  });
});
