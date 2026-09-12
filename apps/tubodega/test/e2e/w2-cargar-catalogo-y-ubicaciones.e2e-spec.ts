// WAVE 2 · «Cargar el catálogo y las ubicaciones». Diego (ADMIN) migra la hoja
// de cálculo de «Distribuidora La Esquina», define sus campos propios, le pone
// fotos y dibuja el árbol de la bodega; Juan (OPERATOR) escanea en el pasillo y
// registra una remesa con lote. Solo el contrato público: ni una consulta a la
// base (spec 06 §6).
import { randomBytes } from 'node:crypto';
import { startTestApp, type TestApp } from '../../../../test/support/e2e/app.js';
import { expectProblem } from '../../../../test/support/e2e/problem.js';
import { registerOrg, type Session, type Tenant } from '../../../../test/support/e2e/tenant.js';

/** Un PNG de un píxel: lo que importa es el content-type, no los píxeles. */
const PNG = {
  bytes: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
  contentType: 'image/png',
};

describe('WAVE 2 · cargar el catálogo y las ubicaciones', () => {
  let t: TestApp;
  let esquina: Tenant;
  let diego: Session;
  let juan: Session;
  let sofia: Session;

  const slug = `la-esquina-${randomBytes(4).toString('hex')}`;

  /** Ids que la narrativa va descubriendo por el contrato, nunca por la base. */
  const id: Record<string, string> = {};

  beforeAll(async () => {
    t = await startTestApp();
    esquina = await registerOrg(t.http, { slug });
    diego = await esquina.user('ADMIN', 'diego');
    juan = await esquina.user('OPERATOR', 'juan');
    sofia = await esquina.user('VIEWER', 'sofia');
  }, 60_000);
  afterAll(() => t.stop());

  const asDiego = () => ({ token: diego.token });
  const asJuan = () => ({ token: juan.token });

  it('1 · Diego define los campos propios de la empresa', async () => {
    const proveedor = await t.http.post(
      '/v1/custom-fields',
      { entity: 'PRODUCT', key: 'proveedor', label: 'Proveedor', type: 'TEXT', position: 0 },
      asDiego(),
    );
    expect(proveedor.status).toBe(201);
    expect(proveedor.headers.location).toBe(`/v1/custom-fields/${proveedor.body.id}`);
    id.proveedor = proveedor.body.id;

    const familia = await t.http.post(
      '/v1/custom-fields',
      {
        entity: 'PRODUCT',
        key: 'familia',
        label: 'Familia',
        type: 'SELECT',
        options: ['ferretería', 'aseo'],
        position: 1,
      },
      asDiego(),
    );
    expect(familia.status).toBe(201);
    id.familia = familia.body.id;

    const listed = await t.http.get('/v1/custom-fields?entity=PRODUCT', asDiego());
    expect(listed.body.data.map((d: { key: string }) => d.key)).toEqual(['proveedor', 'familia']);

    // El label cambia libremente…
    const renamed = await t.http.patch(
      `/v1/custom-fields/${id.familia}`,
      { label: 'Familia de producto' },
      { ...asDiego(), ifMatch: 1 },
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body.label).toBe('Familia de producto');
    // La versión que vuelve es la que quedó guardada, así que sirve para el
    // siguiente If-Match sin tener que releer la definición.
    expect(renamed.body.version).toBe(2);
    const again = await t.http.patch(
      `/v1/custom-fields/${id.familia}`,
      { label: 'Familia' },
      { ...asDiego(), ifMatch: renamed.body.version },
    );
    expect(again.status).toBe(200);
    expectProblem(
      await t.http.patch(`/v1/custom-fields/${id.familia}`, { label: 'Otra' }, { ...asDiego(), ifMatch: 1 }),
      { status: 409, type: 'stale-version' },
    );

    // …y un SELECT sin opciones no es una definición.
    expectProblem(
      await t.http.post(
        '/v1/custom-fields',
        { entity: 'PRODUCT', key: 'marca', label: 'Marca', type: 'SELECT' },
        asDiego(),
      ),
      { status: 422, type: 'invalid-custom-field' },
    );
  });

  it('2 · Criterio 1 · Diego importa la hoja de cálculo', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({
      sku: `IMP-${String(i).padStart(4, '0')}`,
      name: `Artículo ${i}`,
      trackingMode: (['QUANTITY', 'LOT', 'SERIAL'] as const)[i % 3],
      uom: 'UNIT',
      codes: [`EAN-${slug}-${i}`],
      customFields: { proveedor: 'Ferretería Mundial' },
    }));
    // Dos filas malas entre las buenas: la hoja real siempre las trae.
    const conErrores = [
      ...rows.slice(0, 100),
      { sku: '', name: 'Sin SKU' },
      ...rows.slice(100, 199),
      { sku: 'MAL-1', name: 'Familia inventada', customFields: { familia: 'lácteos' } },
      rows[199]!,
    ];

    const res = await t.http.post('/v1/products/import', { rows: conErrores }, asDiego());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ created: 200, updated: 0 });
    expect(res.body.errors).toHaveLength(2);
    expect(res.body.errors[0]).toMatchObject({ line: 101, type: 'validation-failed' });
    expect(res.body.errors[1]).toMatchObject({ line: 201, sku: 'MAL-1', type: 'invalid-custom-field' });

    // Y se pagina por cursor sin repetir ni saltar.
    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      const page = await t.http.get(
        `/v1/products?limit=80&sort=sku${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        asDiego(),
      );
      expect(page.status).toBe(200);
      for (const p of page.body.data) {
        expect(seen.has(p.sku)).toBe(false);
        seen.add(p.sku);
      }
      cursor = page.body.page.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(seen.size).toBe(200);

    // Un SKU ya importado no se crea otra vez (C-1).
    expectProblem(
      await t.http.post(
        '/v1/products',
        { sku: 'IMP-0000', name: 'Repetido', trackingMode: 'QUANTITY', uom: 'UNIT' },
        asDiego(),
      ),
      { status: 409, type: 'sku-taken' },
    );
  }, 60_000);

  it('3 · re-importar actualiza sin duplicar', async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      sku: `IMP-${String(i).padStart(4, '0')}`,
      name: `Artículo NUEVO ${i}`,
    }));
    const res = await t.http.post('/v1/products/import', { rows }, asDiego());
    expect(res.body).toMatchObject({ created: 0, updated: 10, errors: [] });

    const found = await t.http.get('/v1/products?q=NUEVO&limit=200', asDiego());
    expect(found.body.data).toHaveLength(10);

    // Y el total no creció.
    const all = await t.http.get('/v1/products?limit=200&sort=sku', asDiego());
    expect(all.body.data).toHaveLength(200);
  });

  it('4 · Diego define a mano los productos de la narrativa', async () => {
    const tor = await t.http.post(
      '/v1/products',
      {
        sku: 'TOR-M8',
        name: 'Tornillo M8 galvanizado',
        description: 'Rosca fina',
        trackingMode: 'QUANTITY',
        uom: 'UNIT',
        codes: [{ value: `7501-${slug}`, kind: 'EAN' }],
        customFields: { proveedor: 'Ferretería Mundial', familia: 'ferretería' },
      },
      asDiego(),
    );
    expect(tor.status).toBe(201);
    expect(tor.headers.location).toBe(`/v1/products/${tor.body.id}`);
    expect(tor.body).toMatchObject({ sku: 'TOR-M8', active: true, version: 1 });
    expect(tor.body.customFields).toEqual({ proveedor: 'Ferretería Mundial', familia: 'ferretería' });
    id.tor = tor.body.id;

    const tal = await t.http.post(
      '/v1/products',
      { sku: 'TAL-1', name: 'Taladro Bosch', trackingMode: 'SERIAL', uom: 'UNIT' },
      asDiego(),
    );
    id.tal = tal.body.id;

    const leche = await t.http.post(
      '/v1/products',
      { sku: 'LEC-1', name: 'Leche entera', trackingMode: 'LOT', uom: 'L' },
      asDiego(),
    );
    id.leche = leche.body.id;

    // Un campo propio que nadie definió no se cuela en silencio (C-7).
    expectProblem(
      await t.http.post(
        '/v1/products',
        { sku: 'RARO-1', name: 'Raro', trackingMode: 'QUANTITY', uom: 'UNIT', customFields: { color: 'azul' } },
        asDiego(),
      ),
      { status: 422, type: 'invalid-custom-field', pointer: '/customFields/color' },
    );

    // Ni una unidad de medida inventada.
    expectProblem(
      await t.http.post(
        '/v1/products',
        { sku: 'RARO-2', name: 'Raro', trackingMode: 'QUANTITY', uom: 'DOCENA' },
        asDiego(),
      ),
      { status: 422, type: 'validation-failed', pointer: '/uom' },
    );
  });

  it('5 · fotos: Juan las sube y las reclama, Diego las adjunta directo (D-14)', async () => {
    const staged = await t.http.upload('/v1/uploads', PNG, asJuan());
    expect(staged.status).toBe(201);
    expect(typeof staged.body.storageKey).toBe('string');
    expect(typeof staged.body.expiresAt).toBe('string');
    id.key = staged.body.storageKey;

    // Juan reclama su propia clave sobre el producto: le basta RECORD_MOVEMENT.
    const claimed = await t.http.post(
      `/v1/products/${id.tor}/media`,
      { storageKeys: [id.key] },
      asJuan(),
    );
    expect(claimed.status).toBe(201);
    expect(claimed.body).toHaveLength(1);
    id.media = claimed.body[0].id;

    // La foto ya aparece en el producto.
    const withPhoto = await t.http.get(`/v1/products/${id.tor}`, asDiego());
    expect(withPhoto.body.media).toHaveLength(1);
    expect(withPhoto.body.media[0].contentType).toBe('image/png');

    // Reclamarla otra vez ya no es posible.
    expectProblem(
      await t.http.post(`/v1/products/${id.tor}/media`, { storageKeys: [id.key] }, asJuan()),
      { status: 422, type: 'upload-not-found' },
    );

    // Subir multipart directo sí es un cambio de catálogo.
    expectProblem(await t.http.upload(`/v1/products/${id.tor}/media`, PNG, asJuan()), {
      status: 403,
      type: 'insufficient-role',
    });
    const direct = await t.http.upload(`/v1/products/${id.tor}/media`, PNG, asDiego());
    expect(direct.status).toBe(201);
    expect(direct.body[0].position).toBe(1);

    // Y el tipo importa: un texto no es una foto.
    expectProblem(
      await t.http.upload('/v1/uploads', { bytes: Buffer.from('hola'), contentType: 'text/plain' }, asJuan()),
      { status: 415, type: 'unsupported-media-type' },
    );

    // El tamaño lo corta el borde mientras transmite: once megabytes nunca se
    // leen enteros, y el cliente recibe un 413 con el que puede hacer algo.
    expectProblem(
      await t.http.upload(
        '/v1/uploads',
        { bytes: Buffer.alloc(11 * 1024 * 1024, 1), contentType: 'image/png' },
        asJuan(),
      ),
      { status: 413, type: 'media-too-large' },
    );
    expectProblem(
      await t.http.upload(
        `/v1/products/${id.tor}/media`,
        { bytes: Buffer.alloc(11 * 1024 * 1024, 1), contentType: 'image/png' },
        asDiego(),
      ),
      { status: 413, type: 'media-too-large' },
    );
  });

  it('5b · y Diego quita una', async () => {
    const removed = await t.http.del(`/v1/products/${id.tor}/media/${id.media}`, asDiego());
    expect(removed.status).toBe(204);

    const after = await t.http.get(`/v1/products/${id.tor}`, asDiego());
    expect(after.body.media).toHaveLength(1);
    expect(after.body.media[0].id).not.toBe(id.media);

    // Quitarla dos veces es un 404, no un 204 silencioso.
    expectProblem(await t.http.del(`/v1/products/${id.tor}/media/${id.media}`, asDiego()), {
      status: 404,
      type: 'not-found',
    });
  });

  it('6 · códigos: únicos por organización, y el error dice quién lo usa (C-2)', async () => {
    const added = await t.http.post(
      `/v1/products/${id.tal}/codes`,
      { value: `QR-${slug}`, kind: 'INTERNAL_QR' },
      asDiego(),
    );
    expect(added.status).toBe(201);
    id.code = added.body.id;

    const clash = await t.http.post(
      `/v1/products/${id.leche}/codes`,
      { value: `QR-${slug}`, kind: 'INTERNAL_QR' },
      asDiego(),
    );
    expectProblem(clash, { status: 409, type: 'code-taken' });
    expect(clash.body.detail).toContain('TAL-1');

    const listed = await t.http.get(`/v1/products/${id.tal}/codes`, asDiego());
    expect(listed.body).toHaveLength(1);

    expect((await t.http.del(`/v1/products/${id.tal}/codes/${id.code}`, asDiego())).status).toBe(204);
    expectProblem(await t.http.del(`/v1/products/${id.tal}/codes/${id.code}`, asDiego()), {
      status: 404,
      type: 'code-not-found',
    });
  });

  it('7 · Juan escanea en el pasillo', async () => {
    const porCodigo = await t.http.get(`/v1/codes/7501-${slug}/resolve`, asJuan());
    expect(porCodigo.status).toBe(200);
    expect(porCodigo.body.product.sku).toBe('TOR-M8');
    expect(porCodigo.body.batch).toBeUndefined();

    // El SKU tecleado de la hoja funciona igual que el escáner.
    const porSku = await t.http.get('/v1/codes/TOR-M8/resolve', asJuan());
    expect(porSku.body.product.id).toBe(id.tor);

    // Y en minúsculas también: un SKU es un SKU.
    expect((await t.http.get('/v1/codes/tor-m8/resolve', asJuan())).body.product.id).toBe(id.tor);

    expectProblem(await t.http.get('/v1/codes/NOEXISTE/resolve', asJuan()), {
      status: 404,
      type: 'code-not-found',
    });
  });

  it('8 · Juan registra la serie del taladro (C-5)', async () => {
    const serie = await t.http.post(`/v1/products/${id.tal}/batches`, { serial: 'BSH-001' }, asJuan());
    expect(serie.status).toBe(201);
    expect(serie.body.serial).toBe('BSH-001');

    // Escanear la serie devuelve el producto **y** la unidad concreta.
    const scanned = await t.http.get('/v1/codes/BSH-001/resolve', asJuan());
    expect(scanned.body.product.sku).toBe('TAL-1');
    expect(scanned.body.batch.serial).toBe('BSH-001');

    expectProblem(
      await t.http.post(`/v1/products/${id.tal}/batches`, { serial: 'BSH-001' }, asJuan()),
      { status: 409, type: 'serial-taken' },
    );

    // Un producto por cantidad no admite lotes (C-4).
    expectProblem(await t.http.post(`/v1/products/${id.tor}/batches`, { lotCode: 'L-1' }, asJuan()), {
      status: 422,
      type: 'batch-not-allowed',
    });
  });

  it('9 · lote con vencimiento (C-3, C-6)', async () => {
    const lote = await t.http.post(
      `/v1/products/${id.leche}/batches`,
      { lotCode: 'L-2026-09', expiresAt: '2026-10-01T00:00:00.000Z' },
      asJuan(),
    );
    expect(lote.status).toBe(201);
    expect(lote.body.expiresAt).toBe('2026-10-01T00:00:00.000Z');

    expectProblem(
      await t.http.post(`/v1/products/${id.leche}/batches`, { lotCode: 'L-2026-09' }, asJuan()),
      { status: 409, type: 'lot-code-taken' },
    );

    // Sin lotCode, un producto por lote no sabe qué remesa es.
    expectProblem(await t.http.post(`/v1/products/${id.leche}/batches`, {}, asJuan()), {
      status: 422,
      type: 'batch-required',
      pointer: '/lotCode',
    });

    const listed = await t.http.get(`/v1/products/${id.leche}/batches`, asJuan());
    expect(listed.body).toHaveLength(1);

    // El código de lote no resuelve: sin producto es ambiguo.
    expectProblem(await t.http.get('/v1/codes/L-2026-09/resolve', asJuan()), {
      status: 404,
      type: 'code-not-found',
    });
  });

  it('10 · Juan y Sofía no tocan el catálogo', async () => {
    for (const session of [juan, sofia]) {
      expectProblem(
        await t.http.post(
          '/v1/products',
          { sku: 'PROHIBIDO-1', name: 'x', trackingMode: 'QUANTITY', uom: 'UNIT' },
          { token: session.token },
        ),
        { status: 403, type: 'insufficient-role' },
      );
    }
    // Pero Sofía sí lee, que para eso es VIEWER.
    expect((await t.http.get('/v1/products?limit=5', { token: sofia.token })).status).toBe(200);

    // Y Sofía no crea lotes: CREATE_BATCH es de OPERATOR para arriba.
    expectProblem(
      await t.http.post(`/v1/products/${id.leche}/batches`, { lotCode: 'L-X' }, { token: sofia.token }),
      { status: 403, type: 'insufficient-role' },
    );
  });

  it('11 · edición con control de versión', async () => {
    const ok = await t.http.patch(
      `/v1/products/${id.tor}`,
      { name: 'Tornillo M8 inoxidable' },
      { ...asDiego(), ifMatch: 1 },
    );
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe('Tornillo M8 inoxidable');
    // La versión que vuelve es la que quedó guardada, así que sirve para el
    // siguiente If-Match sin tener que releer el producto.
    expect(ok.body.version).toBe(2);

    expectProblem(
      await t.http.patch(`/v1/products/${id.tor}`, { name: 'Otro' }, { ...asDiego(), ifMatch: 1 }),
      { status: 409, type: 'stale-version' },
    );
    expectProblem(
      await t.http.patch(`/v1/products/${id.tor}`, { name: 'Otro' }, asDiego() as never),
      { status: 400, type: 'missing-if-match' },
    );

    // C-8 · sin movimientos todavía, el modo de seguimiento sí cambia.
    const mode = await t.http.patch(
      `/v1/products/${id.tor}`,
      { trackingMode: 'LOT' },
      { ...asDiego(), ifMatch: ok.body.version },
    );
    expect(mode.status).toBe(200);
    expect(mode.body.trackingMode).toBe('LOT');
    expect(mode.body.version).toBe(ok.body.version + 1);
    // Y se deshace, para que el resto del relato lo siga viendo por cantidad.
    expect(
      (
        await t.http.patch(
          `/v1/products/${id.tor}`,
          { trackingMode: 'QUANTITY' },
          { ...asDiego(), ifMatch: mode.body.version },
        )
      ).status,
    ).toBe(200);
  });

  it('12 · Criterio 2 · Diego dibuja el árbol de la bodega', async () => {
    // Los ocho de frontera ya estaban antes de que nadie creara nada: los
    // sembró el provisioner dentro de la transacción que dio de alta la
    // organización (D-2, spec 04 §6).
    const sources = await t.http.get('/v1/nodes?kind=SOURCE', asDiego());
    expect(sources.status).toBe(200);
    expect(sources.body.data).toHaveLength(3);
    const terminals = await t.http.get('/v1/nodes?kind=TERMINAL', asDiego());
    expect(terminals.body.data).toHaveLength(5);

    const nodo = async (code: string, parentId?: string) => {
      const res = await t.http.post(
        '/v1/nodes',
        { kind: 'INTERNAL', code, name: code, ...(parentId ? { parentId } : {}) },
        asDiego(),
      );
      expect(res.status).toBe(201);
      expect(res.headers.location).toBe(`/v1/nodes/${res.body.id}`);
      id[code] = res.body.id;
      return res.body;
    };

    const bodA = await nodo('BOD-A');
    expect(bodA.path).toBe('BOD-A');
    await nodo('MUELLE', id['BOD-A']);
    await nodo('Z1', id['BOD-A']);
    await nodo('E3', id.Z1);
    const b2 = await nodo('B2', id.E3);
    await nodo('B3', id.E3);
    // BOD-B lleva Z2 y no otro Z1: el código es único por organización, no por
    // padre — el escáner no sabe bajo qué bodega está (D-22).
    await nodo('BOD-B');
    await nodo('Z2', id['BOD-B']);

    expect(b2.path).toBe('BOD-A/Z1/E3/B2');

    // Y por eso mismo, repetir un código choca.
    expectProblem(
      await t.http.post('/v1/nodes', { kind: 'INTERNAL', code: 'B2', name: 'Otro' }, asDiego()),
      { status: 409, type: 'node-code-taken' },
    );

    // El árbol llega anidado, no plano (D-11).
    const tree = await t.http.get(`/v1/nodes/${id['BOD-A']}/tree`, asDiego());
    expect(tree.status).toBe(200);
    expect(tree.body.node.code).toBe('BOD-A');
    expect(tree.body.children.map((c: { node: { code: string } }) => c.node.code).sort()).toEqual(['MUELLE', 'Z1']);
    const z1 = tree.body.children.find((c: { node: { code: string } }) => c.node.code === 'Z1');
    expect(z1.children[0].node.code).toBe('E3');
    expect(z1.children[0].children.map((c: { node: { code: string } }) => c.node.code).sort()).toEqual(['B2', 'B3']);

    // El listado por subárbol da lo mismo en plano, y es estricto.
    const under = await t.http.get(`/v1/nodes?under=${id.Z1}`, asDiego());
    expect(under.body.data.map((n: { code: string }) => n.code).sort()).toEqual(['B2', 'B3', 'E3']);

    // Un under que no nombra a nadie es un filtro malo, no un 404 ni una página
    // vacía que escondería el error de tecleo (D-28).
    expectProblem(
      await t.http.get('/v1/nodes?under=018f0000-0000-7000-8000-00000000dead', asDiego()),
      { status: 400, type: 'invalid-filter', pointer: '/under' },
    );
  });

  it('13 · Diego reorganiza los estantes', async () => {
    // Primero el ciclo, mientras B2 todavía cuelga de Z1 a tres niveles de
    // distancia: colgar Z1 de su propio bisnieto cerraría el árbol sobre sí.
    expectProblem(
      await t.http.post(`/v1/nodes/${id.Z1}/move`, { parentId: id.B2 }, { ...asDiego(), ifMatch: 1 }),
      { status: 422, type: 'node-cycle' },
    );

    // Mover E3 arrastra a B2 y B3 sin que nadie los toque (N-1, N-2).
    const moved = await t.http.post(
      `/v1/nodes/${id.E3}/move`,
      { parentId: id.Z2 },
      { ...asDiego(), ifMatch: 1 },
    );
    expect(moved.status).toBe(200);
    expect(moved.body.path).toBe('BOD-B/Z2/E3');

    const b2 = await t.http.get(`/v1/nodes/${id.B2}`, asDiego());
    expect(b2.body.path).toBe('BOD-B/Z2/E3/B2');
    const b3 = await t.http.get(`/v1/nodes/${id.B3}`, asDiego());
    expect(b3.body.path).toBe('BOD-B/Z2/E3/B3');

    // Z1 ya puede colgar de B2: el movimiento anterior sacó a B2 de su subárbol,
    // y quien decide es el path de ahora, no el de antes.
    const z1 = await t.http.get(`/v1/nodes/${id.Z1}`, asDiego());
    const bajoB2 = await t.http.post(
      `/v1/nodes/${id.Z1}/move`,
      { parentId: id.B2 },
      { ...asDiego(), ifMatch: z1.body.version },
    );
    expect(bajoB2.status).toBe(200);
    expect(bajoB2.body.path).toBe('BOD-B/Z2/E3/B2/Z1');

    // Y ahora el ciclo es el de arriba: BOD-B está por encima de B2.
    expectProblem(
      await t.http.post(`/v1/nodes/${id['BOD-B']}/move`, { parentId: id.B2 }, { ...asDiego(), ifMatch: 1 }),
      { status: 422, type: 'node-cycle' },
    );

    // Devolvemos Z1 a su bodega, que es donde la narrativa la deja.
    const vuelta = await t.http.get(`/v1/nodes/${id.Z1}`, asDiego());
    const devuelta = await t.http.post(
      `/v1/nodes/${id.Z1}/move`,
      { parentId: id['BOD-A'] },
      { ...asDiego(), ifMatch: vuelta.body.version },
    );
    expect(devuelta.body.path).toBe('BOD-A/Z1');

    const renamed = await t.http.patch(
      `/v1/nodes/${id.B2}`,
      { name: 'Bin 2 · refrigerado' },
      { ...asDiego(), ifMatch: b2.body.version },
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Bin 2 · refrigerado');
    // La versión que vuelve es la que quedó guardada, así que sirve para el
    // siguiente If-Match sin tener que releer el nodo.
    expect(renamed.body.version).toBe(b2.body.version + 1);
    const again = await t.http.patch(
      `/v1/nodes/${id.B2}`,
      { name: 'Bin 2' },
      { ...asDiego(), ifMatch: renamed.body.version },
    );
    expect(again.status).toBe(200);

    expectProblem(
      await t.http.patch(`/v1/nodes/${id.B2}`, { name: 'Otro' }, { ...asDiego(), ifMatch: b2.body.version }),
      { status: 409, type: 'stale-version' },
    );

    // El tipo no se cambia, y decirlo en voz alta es un 400: si el borde lo
    // borrara en silencio, el cliente recibiría un 200 que no cambió nada.
    expectProblem(
      await t.http.patch(`/v1/nodes/${id.B2}`, { kind: 'CUSTODY' }, { ...asDiego(), ifMatch: renamed.body.version }),
      { status: 400, type: 'validation-failed', pointer: '/kind' },
    );
  });

  it('14 · las reglas del árbol: solo lo interno anida (I-10)', async () => {
    expectProblem(
      await t.http.post('/v1/nodes', { kind: 'CUSTODY', code: 'juan', name: 'Juan', parentId: id.Z1 }, asDiego()),
      { status: 422, type: 'parent-not-internal' },
    );

    const juan = await t.http.post('/v1/nodes', { kind: 'CUSTODY', code: 'juan', name: 'Juan' }, asDiego());
    expect(juan.status).toBe(201);
    expect(juan.body.path).toBe('juan');
    expect(juan.body.parentId).toBeUndefined();
    id.juan = juan.body.id;

    // Y tampoco se cuelga después, moviéndolo.
    expectProblem(
      await t.http.post(`/v1/nodes/${id.juan}/move`, { parentId: id.Z1 }, { ...asDiego(), ifMatch: 1 }),
      { status: 422, type: 'parent-not-internal' },
    );
  });

  it('15 · Diego retira un bin vacío, pero no una zona con estantes', async () => {
    const gone = await t.http.del(`/v1/nodes/${id.B3}`, asDiego());
    expect(gone.status).toBe(204);
    const b3 = await t.http.get(`/v1/nodes/${id.B3}`, asDiego());
    expect(b3.body.active).toBe(false);

    // E3 todavía cuelga B2. Ni cascada ni silencio: un estante activo bajo una
    // zona retirada seguiría admitiendo mercancía (D-30). N-3 con saldo llega
    // en la WAVE 3, cuando haya forma de crear un saldo por el contrato.
    expectProblem(await t.http.del(`/v1/nodes/${id.E3}`, asDiego()), {
      status: 422,
      type: 'node-has-children',
    });

    // Un OPERATOR no dibuja ni retira la bodega.
    expectProblem(
      await t.http.post('/v1/nodes', { kind: 'INTERNAL', code: 'PIRATA', name: 'Pirata' }, asJuan()),
      { status: 403, type: 'insufficient-role' },
    );
  });

  it('16 · C-9 · sin existencias, el producto se retira del catálogo', async () => {
    const sobra = await t.http.post(
      '/v1/products',
      { sku: 'RETIRO-1', name: 'Para retirar', trackingMode: 'QUANTITY', uom: 'UNIT' },
      asDiego(),
    );
    expect((await t.http.del(`/v1/products/${sobra.body.id}`, asDiego())).status).toBe(204);

    const after = await t.http.get(`/v1/products/${sobra.body.id}`, asDiego());
    expect(after.body.active).toBe(false);

    // Y deja de aparecer entre los activos.
    const activos = await t.http.get('/v1/products?active=false&limit=200', asDiego());
    expect(activos.body.data.map((p: { sku: string }) => p.sku)).toContain('RETIRO-1');
  });

  it('17 · campo obligatorio retroactivo (C-10)', async () => {
    const failure = await t.http.post(
      '/v1/custom-fields',
      { entity: 'PRODUCT', key: 'ubicacion_fiscal', label: 'Ubicación fiscal', type: 'TEXT', required: true },
      asDiego(),
    );
    expectProblem(failure, { status: 422, type: 'required-field-would-invalidate' });
    expect(failure.body.detail).toMatch(/\d+ entidades/);

    // D-10 · y el tipo de un campo con valores tampoco cambia.
    expectProblem(
      await t.http.patch(
        `/v1/custom-fields/${id.proveedor}`,
        { type: 'NUMBER' },
        { ...asDiego(), ifMatch: 1 },
      ),
      { status: 422, type: 'custom-field-type-locked' },
    );
  });

  it('18 · reintentos seguros sobre el catálogo (I-7)', async () => {
    const key = `idem-${randomBytes(8).toString('hex')}`;
    const body = { sku: 'IDEM-1', name: 'Idempotente', trackingMode: 'QUANTITY', uom: 'UNIT' };

    const first = await t.http.post('/v1/products', body, { ...asDiego(), idem: key });
    expect(first.status).toBe(201);
    const replay = await t.http.post('/v1/products', body, { ...asDiego(), idem: key });
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(replay.headers['idempotency-replayed']).toBe('true');

    expectProblem(
      await t.http.post('/v1/products', { ...body, name: 'Otro' }, { ...asDiego(), idem: key }),
      { status: 409, type: 'idempotency-key-reuse' },
    );
    expectProblem(await t.http.post('/v1/products', body, { ...asDiego(), idem: false }), {
      status: 400,
      type: 'missing-idempotency-key',
    });
  });

  it('19 · filtros y orden: lo no declarado se rechaza', async () => {
    expectProblem(await t.http.get('/v1/products?foo=1', asDiego()), {
      status: 400,
      type: 'invalid-filter',
      pointer: '/foo',
    });
    expectProblem(await t.http.get('/v1/products?trackingMode=MAGIA', asDiego()), {
      status: 400,
      type: 'invalid-filter',
    });
    expectProblem(await t.http.get('/v1/custom-fields?entity=PLANETA', asDiego()), {
      status: 400,
      type: 'invalid-filter',
    });

    const porModo = await t.http.get('/v1/products?trackingMode=SERIAL&limit=200', asDiego());
    expect(porModo.body.data.every((p: { trackingMode: string }) => p.trackingMode === 'SERIAL')).toBe(true);
    expect(porModo.body.data.length).toBeGreaterThan(0);

    const desc = await t.http.get('/v1/products?sort=-sku&limit=3', asDiego());
    const skus = desc.body.data.map((p: { sku: string }) => p.sku);
    expect([...skus].sort().reverse()).toEqual(skus);
  });

  it('20 · otra empresa no ve nada: 404 y nunca 403 (I-6)', async () => {
    const otra = await registerOrg(t.http, { slug: `otra-${randomBytes(4).toString('hex')}` });
    const ajeno = { token: otra.owner.token };

    const notFound = { status: 404, type: 'not-found' } as const;
    expectProblem(await t.http.get(`/v1/products/${id.tor}`, ajeno), notFound);
    expectProblem(
      await t.http.patch(`/v1/products/${id.tor}`, { name: 'x' }, { ...ajeno, ifMatch: 1 }),
      notFound,
    );
    expectProblem(await t.http.del(`/v1/products/${id.tor}`, ajeno), notFound);
    expectProblem(await t.http.get(`/v1/products/${id.tor}/batches`, ajeno), notFound);
    expectProblem(await t.http.get(`/v1/products/${id.tor}/codes`, ajeno), notFound);
    expectProblem(
      await t.http.patch(`/v1/custom-fields/${id.proveedor}`, { label: 'x' }, { ...ajeno, ifMatch: 1 }),
      notFound,
    );

    // Su catálogo está vacío, y el SKU de la otra empresa está libre para ella.
    expect((await t.http.get('/v1/products?limit=5', ajeno)).body.data).toEqual([]);
    expect(
      (
        await t.http.post(
          '/v1/products',
          { sku: 'TOR-M8', name: 'Su propio tornillo', trackingMode: 'QUANTITY', uom: 'UNIT' },
          ajeno,
        )
      ).status,
    ).toBe(201);

    // Y el escaneo tampoco cruza: el código existe, pero no para ella (C-2 es por organización).
    expectProblem(await t.http.get(`/v1/codes/7501-${slug}/resolve`, ajeno), {
      status: 404,
      type: 'code-not-found',
    });

    // La bodega tampoco se ve desde fuera, y por el mismo camino: 404, nunca 403.
    expectProblem(await t.http.get(`/v1/nodes/${id.Z1}`, ajeno), notFound);
    expectProblem(await t.http.get(`/v1/nodes/${id.Z1}/tree`, ajeno), notFound);
    expectProblem(
      await t.http.post(`/v1/nodes/${id.Z1}/move`, { parentId: id['BOD-B'] }, { ...ajeno, ifMatch: 1 }),
      notFound,
    );
    expectProblem(await t.http.del(`/v1/nodes/${id.Z1}`, ajeno), notFound);

    // Ella tiene sus ocho de frontera y ninguno de los de La Esquina; y «Z1»
    // está libre para ella, porque el código es único por organización.
    const suyos = await t.http.get('/v1/nodes?limit=200', ajeno);
    expect(suyos.body.data).toHaveLength(8);
    expect(suyos.body.data.map((n: { id: string }) => n.id)).not.toContain(id.Z1);
    expect(
      (await t.http.post('/v1/nodes', { kind: 'INTERNAL', code: 'Z1', name: 'Su zona' }, ajeno)).status,
    ).toBe(201);
  });

  it('21 · el contrato del catálogo y de las ubicaciones está publicado', async () => {
    const doc = await t.http.get('/v1/openapi.json');
    expect(doc.status).toBe(200);
    for (const path of [
      '/v1/products',
      '/v1/products/{id}',
      '/v1/products/import',
      '/v1/codes/{value}/resolve',
      '/v1/custom-fields',
      '/v1/uploads',
      '/v1/nodes',
      '/v1/nodes/{id}',
      '/v1/nodes/{id}/move',
      '/v1/nodes/{id}/tree',
    ]) {
      expect(Object.keys(doc.body.paths)).toContain(path);
    }
  });
});
