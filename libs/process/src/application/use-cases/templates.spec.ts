import { v7 } from 'uuid';
import { unwrap, type OrgId } from '@app/common';
import { Role } from '@app/tenancy';
import { aContext } from '../../../test/builders/a-context.js';
import { ORG } from '../../../test/builders/a-template.js';
import { InMemoryTemplateRepository } from '../../../test/doubles/in-memory-template.repository.js';
import { FACTORY_TEMPLATES } from '../../domain/factory-templates.js';
import { ProcessTemplate } from '../../domain/template.js';
import type { ProcessTemplateId } from '../../domain/ids.js';
import { GetActiveTemplate } from './get-active-template.js';
import { ListTemplates } from './list-templates.js';

const build = () => {
  const repo = new InMemoryTemplateRepository();
  return { repo, list: new ListTemplates(repo), get: new GetActiveTemplate(repo) };
};

const sembrar = (repo: InMemoryTemplateRepository, orgId: OrgId = ORG, over: Partial<{ active: boolean }> = {}) => {
  for (const f of FACTORY_TEMPLATES) {
    void repo.save(
      unwrap(
        ProcessTemplate.create({
          id: v7() as ProcessTemplateId, orgId, code: f.code, version: f.version, steps: f.steps,
          ...(over.active !== undefined ? { active: over.active } : {}),
        }),
      ),
    );
  }
};

describe('ListTemplates', () => {
  it('devuelve las seis activas de la organización del contexto', async () => {
    const t = build();
    sembrar(t.repo);
    const found = await t.list.execute(aContext());
    expect(found.map((p) => p.code)).toEqual([
      'AJUSTE_ENTRADA', 'AJUSTE_SALIDA', 'CUSTODIA', 'RECEPCION', 'SALIDA', 'TRASLADO',
    ]);
  });

  it('deja fuera las inactivas: una versión vieja no es una plantilla que ofrecer', async () => {
    const t = build();
    sembrar(t.repo, ORG, { active: false });
    expect(await t.list.execute(aContext())).toEqual([]);
  });

  it('no ve las de otra organización (I-6)', async () => {
    const t = build();
    sembrar(t.repo, '018f0000-0000-7000-8000-0000000000ff' as OrgId);
    expect(await t.list.execute(aContext())).toEqual([]);
  });

  it('un VIEWER puede leerlas', async () => {
    const t = build();
    sembrar(t.repo);
    expect(await t.list.execute(aContext([Role.VIEWER]))).toHaveLength(6);
  });

  // La autorización no vive en el borde: primera línea del execute.
  it('sin READ no se leen', async () => {
    const t = build();
    sembrar(t.repo);
    await expect(t.list.execute({ ...aContext(), roles: new Set() })).rejects.toMatchObject({
      type: 'insufficient-role', status: 403,
    });
  });
});

describe('GetActiveTemplate', () => {
  it('devuelve la versión activa, con sus pasos', async () => {
    const t = build();
    sembrar(t.repo);
    const one = await t.get.execute(aContext(), 'RECEPCION');
    expect(one.version).toBe(1);
    expect(one.steps).toHaveLength(7);
  });

  it('un código que no existe es 404 template-not-found', async () => {
    const t = build();
    sembrar(t.repo);
    await expect(t.get.execute(aContext(), 'NOEXISTE')).rejects.toMatchObject({
      type: 'template-not-found', status: 404,
    });
  });

  it('y un código que existe pero no tiene versión activa, también', async () => {
    const t = build();
    sembrar(t.repo, ORG, { active: false });
    await expect(t.get.execute(aContext(), 'RECEPCION')).rejects.toMatchObject({
      type: 'template-not-found',
    });
  });

  /**
   * Un código que no cabe en la columna no puede existir, así que es un 404 y
   * no un 422: `/v1/process-templates/{code}` contestando «tu código mide más
   * de 64 caracteres» le estaría contando al cliente el ancho de una columna.
   */
  it('un código imposible también es 404, no un error de forma', async () => {
    const t = build();
    await expect(t.get.execute(aContext(), 'A'.repeat(65))).rejects.toMatchObject({
      type: 'template-not-found', status: 404,
    });
  });

  it('la de otra organización no está (I-6, nunca 403)', async () => {
    const t = build();
    sembrar(t.repo, '018f0000-0000-7000-8000-0000000000ff' as OrgId);
    await expect(t.get.execute(aContext(), 'RECEPCION')).rejects.toMatchObject({ status: 404 });
  });

  it('sin READ tampoco', async () => {
    const t = build();
    sembrar(t.repo);
    await expect(t.get.execute({ ...aContext(), roles: new Set() }, 'RECEPCION')).rejects.toMatchObject({
      type: 'insufficient-role',
    });
  });
});
