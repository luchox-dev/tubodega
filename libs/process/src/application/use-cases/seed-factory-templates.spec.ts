import { v7 } from 'uuid';
import { unwrap, type IdGenerator, type OrgId } from '@app/common';
import { ORG } from '../../../test/builders/a-template.js';
import { InMemoryTemplateRepository } from '../../../test/doubles/in-memory-template.repository.js';
import { FACTORY_TEMPLATE_CODES } from '../../domain/factory-templates.js';
import { ProcessTemplate } from '../../domain/template.js';
import { TemplateCode } from '../../domain/ids.js';
import { SeedFactoryTemplates } from './seed-factory-templates.js';

const ids: IdGenerator = { next: () => v7() };
const build = () => {
  const repo = new InMemoryTemplateRepository();
  return { repo, seed: new SeedFactoryTemplates(repo, ids) };
};

describe('SeedFactoryTemplates', () => {
  it('siembra las seis en versión 1, todas activas', async () => {
    const { repo, seed } = build();
    await seed.execute(ORG);

    expect(repo.rows).toHaveLength(6);
    expect((await repo.listActive(ORG)).map((t) => t.code).sort()).toEqual([...FACTORY_TEMPLATE_CODES].sort());
    expect(repo.rows.every((t) => t.version === 1 && t.active)).toBe(true);
    expect(repo.rows.every((t) => t.orgId === ORG)).toBe(true);
  });

  it('cada una nace con sus pasos, no vacía', async () => {
    const { repo, seed } = build();
    await seed.execute(ORG);
    const recepcion = await repo.findActive(ORG, unwrap(TemplateCode.of('RECEPCION')));
    expect(recepcion?.steps).toHaveLength(7);
    expect(recepcion?.firstStep().id).toBe('origen');
  });

  /**
   * Idempotente leyendo antes de escribir, y no con ON CONFLICT: un 23505
   * abortaría la transacción que crea la organización, que es exactamente lo
   * que esta idempotencia existe para evitar.
   */
  it('llamarlo dos veces no duplica, y la segunda no escribe nada', async () => {
    const { repo, seed } = build();
    await seed.execute(ORG);
    expect(repo.escrituras).toBe(6);

    await seed.execute(ORG);
    expect(repo.rows).toHaveLength(6);
    expect(repo.escrituras).toBe(6);
  });

  it('cada organización tiene las suyas', async () => {
    const { repo, seed } = build();
    const otra = '018f0000-0000-7000-8000-0000000000ff' as OrgId;
    await seed.execute(ORG);
    await seed.execute(otra);
    expect(repo.rows).toHaveLength(12);
    expect(await repo.listActive(otra)).toHaveLength(6);
  });

  it('las seis sembradas pasan el validador', async () => {
    const { repo, seed } = build();
    await seed.execute(ORG);
    for (const t of repo.rows) {
      expect(ProcessTemplate.create({ id: t.id, orgId: t.orgId, code: t.code, version: t.version, steps: t.steps }).ok)
        .toBe(true);
    }
  });

  // D-26: cuando corre no hay organización ni token, así que no recibe
  // RequestContext, no llama a requireAction y no publica eventos.
  // `organization.created` ya cuenta el hecho, y nadie "creó" estas seis.
  it('recibe un OrgId y nada más: dos dependencias y un argumento', () => {
    expect(SeedFactoryTemplates.length).toBe(2);
    expect(SeedFactoryTemplates.prototype.execute.length).toBe(1);
  });
});
