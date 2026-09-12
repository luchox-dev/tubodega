import { randomBytes } from 'node:crypto';
import { startTestApp, type TestApp } from '../../../../test/support/e2e/app.js';
import { registerOrg, type Tenant } from '../../../../test/support/e2e/tenant.js';

/**
 * Decision D-2, finally used: the provisioner seeds the eight boundary nodes of
 * spec 04 §6 inside the transaction that creates the organization. Without them
 * double entry has nothing to post against, so this is checked through the
 * contract on a brand-new organization — nobody created these, they were there.
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

  it('cada organización tiene los suyos, y no ve los de al lado (I-6)', async () => {
    const otra = await registerOrg(t.http, { slug: `frontera-${randomBytes(4).toString('hex')}` });
    const mine = await t.http.get('/v1/nodes?kind=SOURCE', asOwner());
    const theirs = await t.http.get('/v1/nodes?kind=SOURCE', { token: otra.owner.token });

    expect(theirs.body.data).toHaveLength(3);
    const mineIds = new Set(mine.body.data.map((n: { id: string }) => n.id));
    for (const n of theirs.body.data) expect(mineIds.has(n.id)).toBe(false);
  });
});
