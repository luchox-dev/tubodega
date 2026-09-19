// WAVE 4 · «Operar con procesos». Juan opera con el teléfono siguiendo lo que
// el servidor le indica, paso a paso, y **nunca consulta la plantilla**: cada
// `complete` usa el `nextStep` que trajo la respuesta anterior. Es la propiedad
// que este módulo existe para dar — un cliente genérico ejecuta las seis
// operaciones sin que la palabra «recepción» aparezca en él.
//
// Diego (ADMIN) versiona la plantilla al final; Marta (OWNER) revisa lo que
// quedó abierto; Sofía (VIEWER) solo mira. Solo el contrato público: ni una
// consulta a la base (spec 06 §6).
//
// **Los saldos y las plantillas se encadenan entre casos.** Estos `it` no son
// independientes: vitest los corre en orden de declaración, y el caso 12
// versiona RECEPCION, así que todo lo que la use tiene que ir antes.
import { randomBytes } from 'node:crypto';
import { startTestApp, type TestApp } from '../../../../test/support/e2e/app.js';
import { expectProblem } from '../../../../test/support/e2e/problem.js';
import { registerOrg, type Session, type Tenant } from '../../../../test/support/e2e/tenant.js';

const DIA = 86_400_000;
const enDias = (d: number) => new Date(Date.now() + d * DIA).toISOString();

const PNG = {
  bytes: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  ),
  contentType: 'image/png',
};

/** Los pasos de una RECEPCION sin foto, para el versionado del caso 12. */
const SIN_FOTO = [
  { id: 'origen', type: 'SELECT_NODE', required: true,
    config: { role: 'FROM', allowedKinds: ['SOURCE'] }, transitions: [{ to: 'item' }] },
  { id: 'item', type: 'SCAN_ITEM', required: true, transitions: [{ to: 'cantidad' }] },
  { id: 'cantidad', type: 'CAPTURE_QTY', required: true, transitions: [{ to: 'destino' }] },
  { id: 'destino', type: 'SELECT_NODE', required: true,
    config: { role: 'TO', allowedKinds: ['INTERNAL'] }, transitions: [{ to: 'confirmar' }] },
  { id: 'confirmar', type: 'CONFIRM', required: true, transitions: [{ to: null }] },
];

describe('WAVE 4 · operar con procesos', () => {
  let t: TestApp;
  let esquina: Tenant;
  let diego: Session;
  let juan: Session;
  let sofia: Session;

  const slug = `la-esquina-${randomBytes(4).toString('hex')}`;

  /** Ids que la narrativa descubre por el contrato, nunca por la base. */
  const id: Record<string, string> = {};

  const asDiego = () => ({ token: diego.token });
  const asJuan = () => ({ token: juan.token });
  const asMarta = () => ({ token: esquina.owner.token });

  // ── Los dos gestos del cliente genérico, y no hay un tercero.
  const abrir = (templateCode: string, s: Session = juan) =>
    t.http.post('/v1/process-instances', { templateCode }, { token: s.token });

  const completar = (
    instanceId: string, stepId: string, payload: unknown, o: { s?: Session; idem?: string } = {},
  ) =>
    t.http.post(
      `/v1/process-instances/${instanceId}/steps/${stepId}/complete`,
      { payload },
      { token: (o.s ?? juan).token, ...(o.idem !== undefined ? { idem: o.idem } : {}) },
    );

  /**
   * Recorre una instancia siguiendo `nextStep` y no una lista escrita aquí: lo
   * que se está probando es justo que el servidor va diciendo qué sigue. El
   * mapa dice qué mandar **cuando** toque cada paso, no en qué orden.
   */
  const recorrer = async (instanceId: string, siguiente: string | undefined, payloads: Record<string, unknown>) => {
    let paso = siguiente;
    let ultima!: Awaited<ReturnType<typeof completar>>;
    while (paso !== undefined) {
      if (!(paso in payloads)) throw new Error(`la plantilla pidió "${paso}" y la prueba no sabe qué mandar`);
      ultima = await completar(instanceId, paso, payloads[paso]);
      if (ultima.status !== 200) return ultima;
      paso = ultima.body.nextStep?.id;
    }
    return ultima;
  };

  const saldo = async (nodeId: string, productId: string): Promise<string> => {
    const res = await t.http.get(`/v1/stock?nodeId=${nodeId}&productId=${productId}`, asDiego());
    return res.body.data[0]?.quantity ?? '0.000';
  };

  beforeAll(async () => {
    t = await startTestApp();
    esquina = await registerOrg(t.http, { slug });
    diego = await esquina.user('ADMIN', 'diego');
    juan = await esquina.user('OPERATOR', 'juan');
    sofia = await esquina.user('VIEWER', 'sofia');

    // La bodega: BOD-A › B2, B3.
    const bodA = await t.http.post('/v1/nodes', { kind: 'INTERNAL', code: 'BOD-A', name: 'Bodega A' }, asDiego());
    id.bodA = bodA.body.id;
    for (const code of ['B2', 'B3']) {
      const bin = await t.http.post(
        '/v1/nodes', { kind: 'INTERNAL', code, name: code, parentId: id.bodA }, asDiego(),
      );
      id[code.toLowerCase()] = bin.body.id;
    }

    // Los ocho de frontera los sembró el provisioner; aquí solo se localizan.
    for (const [kind, code, key] of [
      ['SOURCE', 'supplier-default', 'supplier'],
      ['SOURCE', 'opening-balance', 'opening'],
      ['SOURCE', 'adjustment-in', 'adjIn'],
      ['TERMINAL', 'adjustment-out', 'adjOut'],
      ['TERMINAL', 'sale', 'sale'],
    ] as const) {
      const res = await t.http.get(`/v1/nodes?kind=${kind}`, asDiego());
      id[key] = res.body.data.find((n: { code: string }) => n.code === code).id;
    }

    // El tenedor de Juan, para el préstamo del caso 8.
    const custodia = await t.http.post(
      '/v1/nodes', { kind: 'CUSTODY', code: 'juan', name: 'Juan' }, asDiego(),
    );
    id.juanNode = custodia.body.id;

    // El catálogo: tornillo por cantidad, leche por lote, taladro por serie.
    const tor = await t.http.post(
      '/v1/products',
      { sku: 'TOR-M8', name: 'Tornillo M8', trackingMode: 'QUANTITY', uom: 'UNIT' },
      asDiego(),
    );
    id.tor = tor.body.id;
    const eanTor = await t.http.post(
      `/v1/products/${id.tor}/codes`, { kind: 'EAN', value: '7501000000017' }, asDiego(),
    );
    expect(eanTor.status).toBe(201);

    const leche = await t.http.post(
      '/v1/products',
      { sku: 'LECHE-1L', name: 'Leche entera 1L', trackingMode: 'LOT', uom: 'UNIT' },
      asDiego(),
    );
    id.leche = leche.body.id;
    const eanLeche = await t.http.post(
      `/v1/products/${id.leche}/codes`, { kind: 'EAN', value: '7501000000029' }, asDiego(),
    );
    expect(eanLeche.status).toBe(201);

    const tal = await t.http.post(
      '/v1/products',
      { sku: 'TAL-BOSCH', name: 'Taladro Bosch', trackingMode: 'SERIAL', uom: 'UNIT' },
      asDiego(),
    );
    id.tal = tal.body.id;
    const serie = await t.http.post(`/v1/products/${id.tal}/batches`, { serial: 'BSH-001' }, asDiego());
    id.bsh = serie.body.id;

    // El saldo inicial, por HTTP como todo lo demás: sin existencias, el caso 6
    // no tendría qué trasladar y el 9 no podría quedarse corto a propósito.
    await t.http.post(
      '/v1/movements',
      {
        productId: id.tor, fromNodeId: id.opening, toNodeId: id.b2,
        quantity: '500', occurredAt: new Date().toISOString(),
      },
      asDiego(),
    );

    // Un taladro en B2, para poder prestarlo en el caso 8.
    await t.http.post(
      '/v1/movements',
      {
        productId: id.tal, batchId: id.bsh, fromNodeId: id.opening, toNodeId: id.b2,
        quantity: '1', occurredAt: new Date().toISOString(),
      },
      asDiego(),
    );
  }, 60_000);

  afterAll(() => t.stop());

  // ───────────────────────────────────────────────────────────────────────────
  it('1 · las plantillas de fábrica están, y solo esas', async () => {
    const todas = await t.http.get('/v1/process-templates', asJuan());
    expect(todas.status).toBe(200);
    expect(todas.body.data).toHaveLength(6);
    expect(todas.body.data.every((p: { version: number; active: boolean }) => p.version === 1 && p.active)).toBe(true);

    const recepcion = await t.http.get('/v1/process-templates/RECEPCION', asJuan());
    expect(recepcion.status).toBe(200);
    expect(recepcion.body.steps.map((s: { id: string }) => s.id))
      .toEqual(['origen', 'item', 'lote', 'cantidad', 'foto', 'destino', 'confirmar']);
    // P-8: pasar al workflow será retirar esta comprobación, no rediseñar nada.
    expect(recepcion.body.steps.every((s: { transitions: unknown[] }) => s.transitions.length === 1)).toBe(true);
    expect(recepcion.body.steps.at(-1).transitions[0].to).toBeNull();

    // PICKING es una de las que quedaron fuera del MVP, y será una plantilla
    // más el día que llegue — no código nuevo del motor.
    expectProblem(await t.http.get('/v1/process-templates/PICKING', asJuan()),
      { status: 404, type: 'template-not-found' });
    expectProblem(await abrir('PICKING'), { status: 404, type: 'template-not-found' });
  });

  it('2 · criterio 3: una recepción guiada, con un lote que no existía', async () => {
    const abierta = await abrir('RECEPCION');
    expect(abierta.status).toBe(201);
    expect(abierta.body.nextStep.id).toBe('origen');
    expect(abierta.body.instance.templateVersion).toBe(1);
    id.recepcion = abierta.body.instance.id;

    const vence = enDias(30);
    const fin = await recorrer(id.recepcion, abierta.body.nextStep.id, {
      origen: { nodeId: id.supplier },
      // Por el EAN, que es lo que hace un escáner.
      item: { code: '7501000000029' },
      lote: { lotCode: 'L-NUEVO', expiresAt: vence },
      cantidad: { quantity: '24' },
      foto: null,
      destino: { nodeId: id.b2 },
      confirmar: {},
    });

    expect(fin.status).toBe(200);
    expect(fin.body.instance.state).toBe('COMPLETED');
    expect(fin.body.nextStep).toBeUndefined();
    expect(fin.body.movements).toHaveLength(1);
    expect(fin.body.movements[0].processInstanceId).toBe(id.recepcion);

    // El lote se creó en la misma transacción que el movimiento que lo usa: no
    // existe estado con lote sin recepción ni recepción sin lote.
    const lotes = await t.http.get(`/v1/products/${id.leche}/batches`, asDiego());
    const nuevo = lotes.body.find((b: { lotCode: string }) => b.lotCode === 'L-NUEVO');
    expect(nuevo).toBeDefined();
    expect(fin.body.movements[0].batchId).toBe(nuevo.id);
    id.lNuevo = nuevo.id;

    const stock = await t.http.get(`/v1/stock?nodeId=${id.b2}&batchId=${id.lNuevo}`, asDiego());
    expect(stock.body.data[0].quantity).toBe('24.000');

    const detalle = await t.http.get(`/v1/process-instances/${id.recepcion}`, asJuan());
    expect(detalle.status).toBe(200);
    expect(detalle.body.instance.state).toBe('COMPLETED');
    expect(detalle.body.completions).toHaveLength(7);
    expect(detalle.body.currentStep).toBeUndefined();

    const porPaso = Object.fromEntries(
      detalle.body.completions.map((c: { stepId: string; payload: unknown }) => [c.stepId, c.payload]),
    );
    // Omitido: la fila existe y su payload es null. La diferencia entre «se
    // omitió» y «no existe» es precisamente la fila.
    expect(porPaso.foto).toBeNull();
    // Y lo guardado es lo **enriquecido** (D-56): qué entendió el motor, no
    // solo qué llegó.
    expect(porPaso.item).toMatchObject({ code: '7501000000029', productId: id.leche });
    // La cantidad sale como cadena y no como el `Quantity` del dominio: un
    // decimal en JSON ya pasó por un double, y un bigint ni siquiera serializa.
    expect(porPaso.cantidad).toMatchObject({ quantity: '24' });
    expect(JSON.stringify(detalle.body)).toContain('L-NUEVO');
  });

  it('3 · el paso del lote lo decide el producto, no la plantilla', async () => {
    const abierta = await abrir('RECEPCION');
    const inst = abierta.body.instance.id;
    await completar(inst, 'origen', { nodeId: id.supplier });
    await completar(inst, 'item', { code: 'TOR-M8' });

    // El tornillo va por cantidad: aquí el lote sobra.
    expectProblem(await completar(inst, 'lote', { lotCode: 'X-1' }),
      { status: 422, type: 'batch-step-not-allowed' });
    const omitido = await completar(inst, 'lote', null);
    expect(omitido.status).toBe(200);
    expect(omitido.body.nextStep.id).toBe('cantidad');

    // La leche va por lote: aquí omitirlo no vale, y quien lo sabe es el
    // manejador — la plantilla no sabe qué producto va a pasar por ella (D-54).
    const otra = await abrir('RECEPCION');
    const inst2 = otra.body.instance.id;
    await completar(inst2, 'origen', { nodeId: id.supplier });
    await completar(inst2, 'item', { code: 'LECHE-1L' });
    expectProblem(await completar(inst2, 'lote', null),
      { status: 422, type: 'batch-step-required' });
  });

  it('4 · la foto que Juan tomó en el muelle viaja con la recepción', async () => {
    const staged = await t.http.upload('/v1/uploads', PNG, asJuan());
    expect(staged.status).toBe(201);
    const key: string = staged.body.storageKey;

    const abierta = await abrir('RECEPCION');
    const inst = abierta.body.instance.id;
    const fin = await recorrer(inst, abierta.body.nextStep.id, {
      origen: { nodeId: id.supplier },
      item: { code: 'TOR-M8' },
      lote: null,
      cantidad: { quantity: '5' },
      // Reclamar la clave exige RECORD_MOVEMENT, que es lo que tiene el
      // operario que la subió (D-14).
      foto: { storageKeys: [key] },
      destino: { nodeId: id.b2 },
      confirmar: {},
    });
    expect(fin.status).toBe(200);
    expect(fin.body.instance.state).toBe('COMPLETED');

    const producto = await t.http.get(`/v1/products/${id.tor}`, asDiego());
    expect(producto.body.media).toHaveLength(1);

    // Reclamada una vez, la zona de espera ya no la tiene. Y lo comprueba
    // `AttachMedia` al aplicar el efecto, no el manejador al capturar: entre
    // capturar y confirmar, otro puede reclamarla (D-58).
    const otra = await abrir('RECEPCION');
    const inst2 = otra.body.instance.id;
    await completar(inst2, 'origen', { nodeId: id.supplier });
    await completar(inst2, 'item', { code: 'TOR-M8' });
    await completar(inst2, 'lote', null);
    await completar(inst2, 'cantidad', { quantity: '1' });
    const repetida = await completar(inst2, 'foto', { storageKeys: [key] });
    expect(repetida.status).toBe(200);
    await completar(inst2, 'destino', { nodeId: id.b2 });
    expectProblem(await completar(inst2, 'confirmar', {}),
      { status: 422, type: 'upload-not-found' });
  });

  it('5 · el servidor manda: el paso, el orden y la forma', async () => {
    const abierta = await abrir('RECEPCION');
    const inst = abierta.body.instance.id;

    // P-2: adelantarse no vale, y el error dice dónde está el proceso.
    const fuera = await completar(inst, 'cantidad', { quantity: '1' });
    expectProblem(fuera, { status: 409, type: 'wrong-step' });
    expect(fuera.body.currentStepId).toBe('origen');

    await completar(inst, 'origen', { nodeId: id.supplier });
    const actual = await completar(inst, 'item', { code: 'TOR-M8' });
    expect(actual.body.nextStep.id).toBe('lote');

    // Y repetir uno ya hecho es P-3, no P-2: decirle «llegaste tarde» a quien
    // ya lo hizo sería mandarlo a buscar algo que no existe.
    expectProblem(await completar(inst, 'origen', { nodeId: id.supplier }),
      { status: 409, type: 'step-already-completed' });

    await completar(inst, 'lote', null);
    // El tornillo se mide en UNIT, que no admite decimales.
    expectProblem(await completar(inst, 'cantidad', { quantity: '2.5' }),
      { status: 422, type: 'invalid-step-payload', pointer: '/quantity' });
    expectProblem(await completar(inst, 'cantidad', { quantity: '0' }),
      { status: 422, type: 'invalid-step-payload', pointer: '/quantity' });
  });

  it('6 · traslado y salida, con los saldos que dejan', async () => {
    const antesB2 = await saldo(id.b2, id.tor);

    const traslado = await abrir('TRASLADO');
    const inst = traslado.body.instance.id;
    // El origen de un traslado es INTERNAL: un proveedor no es una ubicación.
    expectProblem(await completar(inst, 'origen', { nodeId: id.supplier }),
      { status: 422, type: 'invalid-step-payload' });

    const fin = await recorrer(inst, traslado.body.nextStep.id, {
      origen: { nodeId: id.b2 },
      item: { code: 'TOR-M8' },
      lote: null,
      cantidad: { quantity: '10' },
      destino: { nodeId: id.b3 },
      confirmar: {},
    });
    expect(fin.status).toBe(200);
    expect(await saldo(id.b2, id.tor)).toBe(`${Number(antesB2) - 10}.000`);
    expect(await saldo(id.b3, id.tor)).toBe('10.000');

    const salida = await abrir('SALIDA');
    const fin2 = await recorrer(salida.body.instance.id, salida.body.nextStep.id, {
      origen: { nodeId: id.b3 },
      item: { code: 'TOR-M8' },
      lote: null,
      cantidad: { quantity: '5' },
      destino: { nodeId: id.sale },
      confirmar: {},
    });
    expect(fin2.status).toBe(200);
    expect(await saldo(id.b3, id.tor)).toBe('5.000');
  });

  it('7 · los ajustes traen el lado fijo puesto por la plantilla', async () => {
    const entrada = await abrir('AJUSTE_ENTRADA');
    // No hay paso de origen que pedirle a nadie: lo fija el `config` del
    // confirmar, por **código** de nodo y no por uuid — los ocho de frontera
    // son distintos en cada organización.
    expect(entrada.body.nextStep.id).toBe('item');
    const inst = entrada.body.instance.id;

    await completar(inst, 'item', { code: 'TOR-M8' });
    await completar(inst, 'lote', null);
    await completar(inst, 'cantidad', { quantity: '3' });
    expectProblem(await completar(inst, 'motivo', { reason: 'x' }),
      { status: 422, type: 'invalid-step-payload' });
    await completar(inst, 'motivo', { reason: 'conteo cíclico de septiembre' });
    await completar(inst, 'destino', { nodeId: id.b2 });
    const fin = await completar(inst, 'confirmar', {});

    expect(fin.status).toBe(200);
    expect(fin.body.movements[0].fromNodeId).toBe(id.adjIn);
    expect(fin.body.movements[0].reason).toBe('conteo cíclico de septiembre');

    const salida = await abrir('AJUSTE_SALIDA');
    const fin2 = await recorrer(salida.body.instance.id, salida.body.nextStep.id, {
      origen: { nodeId: id.b2 },
      item: { code: 'TOR-M8' },
      lote: null,
      cantidad: { quantity: '1' },
      motivo: { reason: 'se cayó una caja en el muelle' },
      confirmar: {},
    });
    expect(fin2.status).toBe(200);
    expect(fin2.body.movements[0].toNodeId).toBe(id.adjOut);
  });

  it('8 · el préstamo del taladro, con su fecha de devolución', async () => {
    const custodia = await abrir('CUSTODIA');
    const inst = custodia.body.instance.id;

    await completar(inst, 'origen', { nodeId: id.b2 });
    // La serie resuelve a producto **y** unidad: el escaneo ya aporta el lote.
    const escaneo = await completar(inst, 'item', { code: 'BSH-001' });
    expect(escaneo.status).toBe(200);
    // Y por eso omitir el paso del lote sí vale aquí, aunque el taladro sea
    // SERIAL: el manejador mira el contexto, no solo el trackingMode.
    await completar(inst, 'lote', null);
    await completar(inst, 'cantidad', { quantity: '1' });
    await completar(inst, 'tenedor', { nodeId: id.juanNode });

    // I-12: una fecha de devolución en el pasado no es una fecha de devolución.
    expectProblem(await completar(inst, 'vencimiento', { dueAt: enDias(-1) }),
      { status: 422, type: 'invalid-step-payload' });
    const vence = enDias(7);
    await completar(inst, 'vencimiento', { dueAt: vence });
    const fin = await completar(inst, 'confirmar', {});

    expect(fin.status).toBe(200);
    expect(fin.body.movements[0].dueAt).toBe(vence);

    const custodias = await t.http.get('/v1/stock/custodies', asDiego());
    const prestamo = custodias.body.data.find(
      (c: { checkOut: { batchId: string } }) => c.checkOut.batchId === id.bsh,
    );
    expect(prestamo).toBeDefined();
    expect(prestamo.checkOut.dueAt).toBe(vence);
    expect(prestamo.pending).toBe('1.000');
  });

  it('9 · confirmar sin existencias no ensucia nada, y se puede reintentar', async () => {
    const antes = await saldo(id.b3, id.tor);

    const salida = await abrir('SALIDA');
    const inst = salida.body.instance.id;
    await completar(inst, 'origen', { nodeId: id.b3 });
    await completar(inst, 'item', { code: 'TOR-M8' });
    await completar(inst, 'lote', null);
    await completar(inst, 'cantidad', { quantity: '999' });
    await completar(inst, 'destino', { nodeId: id.sale });

    expectProblem(await completar(inst, 'confirmar', {}),
      { status: 422, type: 'insufficient-stock' });

    // P-7 por el lado que importa: el fallo del paso 10 deshace los 8 y 9. La
    // instancia sigue abierta **en el confirmar**, sin su step_completion.
    const detalle = await t.http.get(`/v1/process-instances/${inst}`, asJuan());
    expect(detalle.body.instance.state).toBe('OPEN');
    expect(detalle.body.instance.currentStepId).toBe('confirmar');
    expect(detalle.body.currentStep.id).toBe('confirmar');
    expect(detalle.body.completions.map((c: { stepId: string }) => c.stepId)).not.toContain('confirmar');
    expect(await saldo(id.b3, id.tor)).toBe(antes);

    // Y repetirlo después de reponer funciona: el proceso no quedó envenenado.
    const reposicion = await abrir('RECEPCION');
    await recorrer(reposicion.body.instance.id, reposicion.body.nextStep.id, {
      origen: { nodeId: id.supplier },
      item: { code: 'TOR-M8' },
      lote: null,
      cantidad: { quantity: '1000' },
      foto: null,
      destino: { nodeId: id.b3 },
      confirmar: {},
    });

    const segundo = await completar(inst, 'confirmar', {});
    expect(segundo.status).toBe(200);
    expect(segundo.body.instance.state).toBe('COMPLETED');
    expect(segundo.body.movements).toHaveLength(1);
  });

  it('10 · abandonar a la mitad no deja rastro (P-6)', async () => {
    const abierta = await abrir('RECEPCION');
    const inst = abierta.body.instance.id;
    await completar(inst, 'origen', { nodeId: id.supplier });
    await completar(inst, 'item', { code: 'LECHE-1L' });
    await completar(inst, 'lote', { lotCode: 'L-FANTASMA', expiresAt: enDias(30) });

    const cancelada = await t.http.post(`/v1/process-instances/${inst}/cancel`, {}, asJuan());
    expect(cancelada.status).toBe(200);
    expect(cancelada.body.state).toBe('CANCELLED');
    // Dónde se abandonó es parte de lo que pasó.
    expect(cancelada.body.currentStepId).toBe('cantidad');

    // Ni catálogo ni inventario: es la mitad no evidente de P-6.
    const lotes = await t.http.get(`/v1/products/${id.leche}/batches`, asDiego());
    expect(lotes.body.some((b: { lotCode: string }) => b.lotCode === 'L-FANTASMA')).toBe(false);

    expectProblem(await completar(inst, 'cantidad', { quantity: '1' }),
      { status: 409, type: 'instance-closed' });
    expectProblem(await t.http.post(`/v1/process-instances/${inst}/cancel`, {}, asJuan()),
      { status: 409, type: 'instance-closed' });
  });

  it('11 · el reintento del cliente sin red no duplica el asiento', async () => {
    const abierta = await abrir('RECEPCION');
    const inst = abierta.body.instance.id;
    await completar(inst, 'origen', { nodeId: id.supplier });
    await completar(inst, 'item', { code: 'TOR-M8' });
    await completar(inst, 'lote', null);
    await completar(inst, 'cantidad', { quantity: '7' });
    await completar(inst, 'foto', null);
    await completar(inst, 'destino', { nodeId: id.b2 });

    const clave = crypto.randomUUID();
    const primera = await completar(inst, 'confirmar', {}, { idem: clave });
    expect(primera.status).toBe(200);
    const movimiento = primera.body.movements[0].id;

    // Misma clave, misma respuesta: replay, no un segundo asiento.
    const reintento = await completar(inst, 'confirmar', {}, { idem: clave });
    expect(reintento.status).toBe(200);
    expect(reintento.body.movements[0].id).toBe(movimiento);

    const historico = await t.http.get(`/v1/movements?productId=${id.tor}`, asDiego());
    const suyos = historico.body.data.filter(
      (m: { processInstanceId?: string }) => m.processInstanceId === inst,
    );
    expect(suyos).toHaveLength(1);
  });

  it('12 · Diego versiona la recepción, y lo abierto termina con sus reglas', async () => {
    // Una instancia abierta en v1, que tiene que seguir viendo el paso `foto`.
    const enV1 = await abrir('RECEPCION');
    const viejo = enV1.body.instance.id;
    expect(enV1.body.instance.templateVersion).toBe(1);

    expectProblem(
      await t.http.post('/v1/process-templates/RECEPCION/versions',
        { version: 2, steps: SIN_FOTO }, asJuan()),
      { status: 403, type: 'insufficient-role' },
    );

    const v2 = await t.http.post('/v1/process-templates/RECEPCION/versions',
      { version: 2, steps: SIN_FOTO }, asDiego());
    expect(v2.status).toBe(201);
    expect(v2.body.version).toBe(2);
    expect(v2.body.active).toBe(true);

    const activa = await t.http.get('/v1/process-templates/RECEPCION', asDiego());
    expect(activa.body.version).toBe(2);
    expect(activa.body.steps.map((s: { id: string }) => s.id)).not.toContain('foto');

    // La abierta en v1 sigue con las reglas con las que nació (P-1).
    const detalle = await t.http.get(`/v1/process-instances/${viejo}`, asJuan());
    expect(detalle.body.instance.templateVersion).toBe(1);
    await completar(viejo, 'origen', { nodeId: id.supplier });
    await completar(viejo, 'item', { code: 'TOR-M8' });
    await completar(viejo, 'lote', null);
    const enFoto = await completar(viejo, 'cantidad', { quantity: '2' });
    expect(enFoto.body.nextStep.id).toBe('foto');

    // Y una nueva ya no lo ve.
    const nueva = await abrir('RECEPCION');
    expect(nueva.body.instance.templateVersion).toBe(2);
    await completar(nueva.body.instance.id, 'origen', { nodeId: id.supplier });
    const sinFoto = await completar(nueva.body.instance.id, 'item', { code: 'TOR-M8' });
    expect(sinFoto.body.nextStep.id).toBe('cantidad');

    // P-8 y su hermano aburrido, los dos con mensaje propio.
    expectProblem(
      await t.http.post('/v1/process-templates/RECEPCION/versions', {
        version: 3,
        steps: [
          { id: 'item', type: 'SCAN_ITEM', required: true, transitions: [{ to: 'confirmar' }, { to: null }] },
          { id: 'confirmar', type: 'CONFIRM', required: true, transitions: [{ to: null }] },
        ],
      }, asDiego()),
      { status: 422, type: 'branching-not-supported' },
    );
    expectProblem(
      await t.http.post('/v1/process-templates/RECEPCION/versions', {
        version: 3,
        steps: [{ id: 'raro', type: 'INSPECCION_CALIDAD', required: true, transitions: [{ to: null }] }],
      }, asDiego()),
      { status: 422, type: 'unknown-step-type' },
    );
    // Y la versión que ya existe (D-61).
    expectProblem(
      await t.http.post('/v1/process-templates/RECEPCION/versions',
        { version: 2, steps: SIN_FOTO }, asDiego()),
      { status: 409, type: 'template-version-taken' },
    );
  });

  it('13 · Marta revisa lo que quedó abierto', async () => {
    const abiertas = await t.http.get('/v1/process-instances?state=OPEN', asMarta());
    expect(abiertas.status).toBe(200);
    expect(abiertas.body.data.length).toBeGreaterThan(0);
    expect(abiertas.body.data.every((i: { state: string }) => i.state === 'OPEN')).toBe(true);

    const deJuan = await t.http.get(
      `/v1/process-instances?templateCode=RECEPCION&actorId=${juan.userId}`, asMarta(),
    );
    expect(deJuan.body.data.length).toBeGreaterThan(0);
    expect(deJuan.body.data.every(
      (i: { templateCode: string; actorId: string }) => i.templateCode === 'RECEPCION' && i.actorId === juan.userId,
    )).toBe(true);

    // Lo último primero (D-62), y sin sort que no tenga índice detrás.
    const todas = await t.http.get('/v1/process-instances', asMarta());
    expect(todas.body.data[0].id).toBe(
      (await t.http.get('/v1/process-instances?limit=1', asMarta())).body.data[0].id,
    );

    // Un valor que no existe es 400 y no una página vacía: una página vacía es
    // indistinguible de «no hay ninguno».
    expectProblem(await t.http.get('/v1/process-instances?state=FOO', asMarta()),
      { status: 400, type: 'invalid-filter' });
    expectProblem(await t.http.get('/v1/process-instances?sort=actorId', asMarta()),
      { status: 400, type: 'invalid-filter' });
    expectProblem(await t.http.get('/v1/process-instances?orgId=otra', asMarta()),
      { status: 400, type: 'invalid-filter' });
  });

  it('14 · Sofía solo mira', async () => {
    expectProblem(await abrir('RECEPCION', sofia), { status: 403, type: 'insufficient-role' });

    const leyendo = await t.http.get('/v1/process-instances', { token: sofia.token });
    expect(leyendo.status).toBe(200);
    expect(leyendo.body.data.length).toBeGreaterThan(0);

    const detalle = await t.http.get(`/v1/process-instances/${id.recepcion}`, { token: sofia.token });
    expect(detalle.status).toBe(200);

    expectProblem(
      await t.http.post(`/v1/process-instances/${id.recepcion}/cancel`, {}, { token: sofia.token }),
      { status: 403, type: 'insufficient-role' },
    );
  });
});
