import { randomBytes } from 'node:crypto';
import type { OrgId } from '@app/common';
import { ProcessTemplate, type ProcessTemplateId } from '@app/process';
import { startTestApp, type TestApp } from '../../../../test/support/e2e/app.js';
import { registerOrg, type Tenant } from '../../../../test/support/e2e/tenant.js';

/**
 * Decision D-2, finally used: the provisioner seeds the eight boundary nodes of
 * spec 04 §6 **and the six factory templates of spec 13 §6** inside the
 * transaction that creates the organization. Without the nodes, double entry
 * has nothing to post against; without the templates there is no way to guide
 * anybody. So both are checked through the contract on a brand-new
 * organization — nobody created these, they were there.
 */
describe('la frontera que toda organización trae puesta', () => {
  let t: TestApp;
  let org: Tenant;

  beforeAll(async () => {
    t = await startTestApp();
    org = await registerOrg(t.http, { slug: `frontera-${randomBytes(4).toString('hex')}` });
  }, 60_000);
  afterAll(() => t.stop());

  const asOwner = () => ({ token: org.owner.token });

  it('los ocho nodos de [04 §6] ya están tras el registro', async () => {
    const all = await t.http.get('/v1/nodes?limit=200', asOwner());
    expect(all.status).toBe(200);
    expect(all.body.data.map((n: { code: string }) => n.code).sort()).toEqual([
      'adjustment-in', 'adjustment-out', 'consumption', 'opening-balance',
      'sale', 'shrinkage', 'supplier-default', 'supplier-return',
    ]);
  });

  it('tres fuentes y cinco sumideros, todos raíz', async () => {
    const sources = await t.http.get('/v1/nodes?kind=SOURCE', asOwner());
    expect(sources.body.data).toHaveLength(3);
    const terminals = await t.http.get('/v1/nodes?kind=TERMINAL', asOwner());
    expect(terminals.body.data).toHaveLength(5);

    for (const n of [...sources.body.data, ...terminals.body.data]) {
      expect(n.parentId).toBeUndefined();
      expect(n.path).toBe(n.code);
      expect(n.active).toBe(true);
    }
  });

  it('las seis plantillas de [13 §6] también, en versión 1 y activas', async () => {
    const all = await t.http.get('/v1/process-templates', asOwner());
    expect(all.status).toBe(200);
    expect(all.body.data.map((p: { code: string }) => p.code).sort()).toEqual([
      'AJUSTE_ENTRADA', 'AJUSTE_SALIDA', 'CUSTODIA', 'RECEPCION', 'SALIDA', 'TRASLADO',
    ]);
    for (const p of all.body.data) {
      expect(p.version).toBe(1);
      expect(p.active).toBe(true);
    }
  });

  /**
   * El jsonb de ida y vuelta es donde se rompen estas cosas, así que lo que se
   * comprueba no es que haya seis filas: es que lo que sale de la base se puede
   * ejecutar. Una plantilla sembrada rota aparecería semanas después, en la
   * instancia de alguien, como un 500.
   */
  it('y las seis se releen enteras: pasan el validador del dominio', async () => {
    const all = await t.http.get('/v1/process-templates', asOwner());
    for (const p of all.body.data) {
      const r = ProcessTemplate.create({
        id: p.id as ProcessTemplateId,
        orgId: org.orgId as OrgId,
        code: p.code,
        version: p.version,
        steps: p.steps,
      });
      expect(r.ok, `${p.code}: ${!r.ok ? r.error.message : ''}`).toBe(true);
    }
  });

  it('RECEPCION conserva sus siete pasos, su config y su cierre', async () => {
    const one = await t.http.get('/v1/process-templates/RECEPCION', asOwner());
    expect(one.status).toBe(200);
    expect(one.body.steps.map((s: { id: string }) => s.id)).toEqual([
      'origen', 'item', 'lote', 'cantidad', 'foto', 'destino', 'confirmar',
    ]);
    expect(one.body.steps[0].config).toEqual({ role: 'FROM', allowedKinds: ['SOURCE'] });
    expect(one.body.steps.at(-1).transitions).toEqual([{ to: null }]);
  });

  it('cada organización tiene los suyos, y no ve los de al lado (I-6)', async () => {
    const otra = await registerOrg(t.http, { slug: `frontera-${randomBytes(4).toString('hex')}` });
    const mine = await t.http.get('/v1/nodes?kind=SOURCE', asOwner());
    const theirs = await t.http.get('/v1/nodes?kind=SOURCE', { token: otra.owner.token });

    expect(theirs.body.data).toHaveLength(3);
    const mineIds = new Set(mine.body.data.map((n: { id: string }) => n.id));
    for (const n of theirs.body.data) expect(mineIds.has(n.id)).toBe(false);

    // Y las plantillas igual: seis suyas, ninguna compartida.
    const misPlantillas = await t.http.get('/v1/process-templates', asOwner());
    const susPlantillas = await t.http.get('/v1/process-templates', { token: otra.owner.token });
    expect(susPlantillas.body.data).toHaveLength(6);
    const mios = new Set(misPlantillas.body.data.map((p: { id: string }) => p.id));
    for (const p of susPlantillas.body.data) expect(mios.has(p.id)).toBe(false);
  });
});
