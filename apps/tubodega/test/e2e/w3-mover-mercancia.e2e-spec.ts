// WAVE 3 · «Mover mercancía». El primer día de operación de «Distribuidora La
// Esquina»: Diego (ADMIN) carga el saldo inicial desde la hoja de cálculo; Juan
// (OPERATOR) recibe del proveedor, ubica, traslada y despacha; presta el taladro
// y un saco de arroz; comete un error de cantidad y Diego lo corrige; Marta
// (OWNER) audita al cierre. Solo el contrato público: ni una consulta a la base
// (spec 06 §6).
//
// **Los saldos se encadenan entre casos.** Estos `it` no son independientes:
// vitest los corre en orden de declaración, y w1 y w2 ya dependen de eso. Quien
// reordene los casos los rompe todos, y quien añada un asiento tiene que bajar
// por la columna hasta el caso 14, que afirma el libro mayor entero.
import { randomBytes } from 'node:crypto';
import { startTestApp, type TestApp } from '../../../../test/support/e2e/app.js';
import { expectProblem } from '../../../../test/support/e2e/problem.js';
import { registerOrg, type Session, type Tenant } from '../../../../test/support/e2e/tenant.js';

const DIA = 86_400_000;
const ahora = () => new Date().toISOString();
const enDias = (d: number) => new Date(Date.now() + d * DIA).toISOString();

/**
 * Milésimas exactas, escritas aquí a mano y no importadas de `@app/inventory`.
 * Si la aritmética de la prueba fuera la del dominio, un fallo en `Quantity`
 * saldría verde justo en el caso que existe para cazarlo (D-45). Y nunca un
 * float: 0.1 deja de ser 0.1 mucho antes de llegar a la suma de 221 asientos.
 */
const milli = (q: string): bigint => {
  const negativo = q.startsWith('-');
  const [entero, decimal = ''] = (negativo ? q.slice(1) : q).split('.');
  const m = BigInt(entero!) * 1000n + BigInt(decimal.padEnd(3, '0').slice(0, 3));
  return negativo ? -m : m;
};
const fmt = (m: bigint): string => {
  const abs = m < 0n ? -m : m;
  return `${m < 0n ? '-' : ''}${abs / 1000n}.${String(abs % 1000n).padStart(3, '0')}`;
};

describe('WAVE 3 · mover mercancía', () => {
  let t: TestApp;
  let esquina: Tenant;
  let diego: Session;
  let juan: Session;
  let sofia: Session;

  const slug = `la-esquina-${randomBytes(4).toString('hex')}`;

  /** Ids que la narrativa descubre por el contrato, nunca por la base. */
  const id: Record<string, string> = {};

  /** Los asientos que la narrativa consiguió escribir; el caso 14 los confronta. */
  const asientos = new Set<string>();

  const asDiego = () => ({ token: diego.token });
  const asJuan = () => ({ token: juan.token });
  const asMarta = () => ({ token: esquina.owner.token });

  const mover = async (s: Session, m: Record<string, unknown>, o: { idem?: string } = {}) => {
    const res = await t.http.post(
      '/v1/movements',
      { occurredAt: ahora(), ...m },
      { token: s.token, ...(o.idem !== undefined ? { idem: o.idem } : {}) },
    );
    if (res.status === 201) asientos.add(res.body.movement.id);
    return res;
  };

  const compensar = async (s: Session, movementId: string, reason: string) => {
    const res = await t.http.post(`/v1/movements/${movementId}/reverse`, { reason }, { token: s.token });
    if (res.status === 201) asientos.add(res.body.movement.id);
    return res;
  };

  /** El saldo de una posición, con el cero explícito: `nonZeroOnly` lo escondería. */
  const saldo = async (nodeId: string, productId: string, batchId?: string): Promise<string> => {
    const res = await t.http.get(
      `/v1/stock?nodeId=${nodeId}&productId=${productId}&nonZeroOnly=false&custodialOnly=false`
        + (batchId === undefined ? '' : `&batchId=${batchId}`),
      asJuan(),
    );
    expect(res.status).toBe(200);
    return res.body.data[0]?.quantity ?? '0.000';
  };

  /** Lo que de verdad hay en la bodega de un producto: sin la frontera. */
  const propio = async (productId: string): Promise<string> => {
    const res = await t.http.get(`/v1/stock?productId=${productId}&custodialOnly=true&limit=200`, asJuan());
    expect(res.status).toBe(200);
    return fmt(res.body.data.reduce((s: bigint, p: { quantity: string }) => s + milli(p.quantity), 0n));
  };

  beforeAll(async () => {
    t = await startTestApp();
    esquina = await registerOrg(t.http, { slug });
    diego = await esquina.user('ADMIN', 'diego');
    juan = await esquina.user('OPERATOR', 'juan');
    sofia = await esquina.user('VIEWER', 'sofia');

    // Los ocho nodos de frontera ya existían antes de que nadie creara nada: los
    // sembró el provisioner dentro de la transacción que dio de alta la empresa.
    const frontera = await t.http.get('/v1/nodes?limit=200', asDiego());
    for (const n of frontera.body.data) id[n.code] = n.id;
    expect(Object.keys(id).sort()).toEqual([
      'adjustment-in', 'adjustment-out', 'consumption', 'opening-balance',
      'sale', 'shrinkage', 'supplier-default', 'supplier-return',
    ]);

    const nodo = async (code: string, parent?: string, kind = 'INTERNAL') => {
      const res = await t.http.post(
        '/v1/nodes',
        { kind, code, name: code, ...(parent !== undefined ? { parentId: parent } : {}) },
        asDiego(),
      );
      expect(res.status).toBe(201);
      id[code] = res.body.id;
      return res.body;
    };
    await nodo('BOD-A');
    // El muelle cuelga de la bodega y no de la zona: es lo que hace honesta la
    // agregación por subárbol del caso 3.
    await nodo('MUELLE', id['BOD-A']);
    await nodo('Z1', id['BOD-A']);
    await nodo('E3', id.Z1);
    for (const bin of ['B1', 'B2', 'B3']) await nodo(bin, id.E3);
    // La custodia de Juan no cuelga de nadie: solo un INTERNAL puede ser padre (I-10).
    await nodo('juan', undefined, 'CUSTODY');

    // El path que el caso 6 lee dentro de un `detail`, comprobado aquí: más vale
    // que reviente el montaje que una aserción de texto tres casos más tarde.
    expect((await t.http.get(`/v1/nodes/${id.B3}`, asDiego())).body.path).toBe('BOD-A/Z1/E3/B3');

    const producto = async (sku: string, trackingMode: string, uom = 'UNIT') => {
      const res = await t.http.post('/v1/products', { sku, name: sku, trackingMode, uom }, asDiego());
      expect(res.status).toBe(201);
      return res.body.id as string;
    };
    id.tor = await producto('TOR-M8', 'QUANTITY');
    id.leche = await producto('LECHE-1L', 'LOT', 'L');
    id.tal = await producto('TAL-BOSCH', 'SERIAL');
    id.arroz = await producto('ARROZ-25', 'QUANTITY');
    id.lote = (await t.http.post(`/v1/products/${id.leche}/batches`, { lotCode: 'L-2026-09' }, asDiego())).body.id;
    id.serie = (await t.http.post(`/v1/products/${id.tal}/batches`, { serial: 'BSH-001' }, asDiego())).body.id;
  }, 60_000);

  afterAll(() => t.stop());

  it('1 · Diego carga el saldo inicial desde la hoja de cálculo', async () => {
    const linea = (nodeId: string) => ({
      productId: id.tor, fromNodeId: id['opening-balance'], toNodeId: nodeId,
      quantity: '1', occurredAt: ahora(),
    });
    const hoja = [
      ...Array.from({ length: 100 }, () => linea(id.B1)),
      ...Array.from({ length: 60 }, () => linea(id.B2)),
      ...Array.from({ length: 40 }, () => linea(id.B3)),
    ];

    const res = await t.http.post('/v1/movements/batch', { movements: hoja }, asDiego());
    expect(res.status).toBe(201);
    expect(res.body.movements).toHaveLength(200);
    for (const m of res.body.movements) {
      expect(m.actorId).toBe(diego.userId);
      asientos.add(m.id);
    }
    // Una posición por clave natural, no una por línea: los deltas de las 200 se
    // suman y se aplican en un solo upsert (D-39).
    expect(res.body.balances).toHaveLength(4);

    expect(await propio(id.tor)).toBe('200.000');
    expect(await saldo(id.B1, id.tor)).toBe('100.000');

    // 501 clavados. Con 502 respondería el @ArrayMaxSize del DTO con un 400
    // pelado, y lo que se quiere ver es la respuesta de negocio.
    const pasada = await t.http.post(
      '/v1/movements/batch',
      { movements: Array.from({ length: 501 }, () => linea(id.B1)) },
      asDiego(),
    );
    expectProblem(pasada, { status: 422, type: 'batch-too-large', pointer: '/movements' });
    expect(pasada.body.detail).toContain('500');

    // Una línea mala en medio y no entra ninguna. Cinco y no doscientas: el caso
    // de uso resuelve producto y nodos línea a línea, y probar la coma no vale
    // seiscientos viajes a la base.
    const conError = await t.http.post(
      '/v1/movements/batch',
      {
        movements: [linea(id.B1), linea(id.B1), { ...linea(id.B1), quantity: '0' }, linea(id.B1), linea(id.B1)],
      },
      asDiego(),
    );
    expectProblem(conError, { status: 422, type: 'non-positive-quantity' });
    expect(await saldo(id.B1, id.tor)).toBe('100.000');
  });

  it('2 · Criterio 3 · llega el proveedor y Juan lo ubica', async () => {
    const llegada = await mover(juan, {
      productId: id.tor, fromNodeId: id['supplier-default'], toNodeId: id.MUELLE, quantity: '100',
    });
    expect(llegada.status).toBe(201);
    expect(llegada.headers.location).toBe(`/v1/movements/${llegada.body.movement.id}`);
    expect(llegada.body.movement.actorId).toBe(juan.userId);
    // La partida doble, en la propia respuesta: lo que sale de un lado entra en el otro.
    expect(
      Object.fromEntries(llegada.body.balances.map((b: { nodeId: string; quantity: string }) => [b.nodeId, b.quantity])),
    ).toEqual({ [id.MUELLE]: '100.000', [id['supplier-default']]: '-100.000' });

    const ubicar = await mover(juan, {
      productId: id.tor, fromNodeId: id.MUELLE, toNodeId: id.B2, quantity: '100',
    });
    expect(ubicar.status).toBe(201);

    expect(await saldo(id.MUELLE, id.tor)).toBe('0.000');
    expect(await saldo(id.B2, id.tor)).toBe('160.000');
    // El muelle vacío no aparece en la vista de existencias, que es como debe ser.
    expect((await t.http.get(`/v1/stock?nodeId=${id.MUELLE}&custodialOnly=true`, asJuan())).body.data).toEqual([]);

    const porNodo = await t.http.get(`/v1/movements?nodeId=${id.MUELLE}`, asJuan());
    expect(porNodo.body.data).toHaveLength(2);

    const uno = await t.http.get(`/v1/movements/${llegada.body.movement.id}`, asJuan());
    expect(uno.status).toBe(200);
    expect(uno.body.recordedAt >= uno.body.occurredAt).toBe(true);

    // Y la remesa de leche, que va con lote y entra el mismo día.
    const leche = await mover(juan, {
      productId: id.leche, batchId: id.lote, fromNodeId: id['supplier-default'], toNodeId: id.B2, quantity: '24',
    });
    expect(leche.status).toBe(201);
  });

  it('3 · Criterio 4 · el traslado que cuadra', async () => {
    expect((await mover(juan, {
      productId: id.tor, fromNodeId: id.B2, toNodeId: id.B3, quantity: '40',
    })).status).toBe(201);

    expect(await saldo(id.B2, id.tor)).toBe('120.000');
    expect(await saldo(id.B3, id.tor)).toBe('80.000');

    // El subárbol de Z1 son B1, B2 y B3: el muelle cuelga de la bodega, no de la zona.
    const zona = await t.http.get(`/v1/stock?under=${id.Z1}&productId=${id.tor}`, asJuan());
    expect(zona.status).toBe(200);
    expect(zona.body.data).toHaveLength(1);
    expect(zona.body.data[0].quantity).toBe('300.000');
    // Un total de subárbol no pertenece a ningún nodo, y no hay nada que paginar
    // una vez sumado.
    expect(zona.body.data[0].nodeId).toBe('');
    expect(zona.body.page.hasMore).toBe(false);

    const todo = await t.http.get(`/v1/stock?under=${id.Z1}`, asJuan());
    expect(todo.body.data).toHaveLength(2);
  });

  it('4 · Criterio 6 · la venta', async () => {
    expect((await mover(juan, {
      productId: id.tor, fromNodeId: id.B3, toNodeId: id.sale, quantity: '15',
    })).status).toBe(201);

    expect(await propio(id.tor)).toBe('285.000');
    // El saldo de un TERMINAL es un acumulado —cuánto se ha vendido—, no existencias.
    const vendido = await t.http.get(
      `/v1/stock?nodeId=${id.sale}&productId=${id.tor}&custodialOnly=false&nonZeroOnly=false`, asJuan());
    expect(vendido.body.data[0].quantity).toBe('15.000');
    expect(vendido.body.data[0].nodeKind).toBe('TERMINAL');
  });

  it('5 · la merma y los ajustes exigen motivo; el consumo no', async () => {
    const merma = (over: Record<string, unknown> = {}) => mover(juan, {
      productId: id.tor, fromNodeId: id.B3, toNodeId: id.shrinkage, quantity: '1', ...over,
    });
    expectProblem(await merma(), { status: 422, type: 'reason-required', pointer: '/reason' });
    expectProblem(
      await mover(juan, { productId: id.tor, fromNodeId: id.B3, toNodeId: id['adjustment-out'], quantity: '1' }),
      { status: 422, type: 'reason-required' },
    );
    expect((await merma({ reason: 'se rompió una caja' })).status).toBe(201);

    expect((await mover(diego, {
      productId: id.tor, fromNodeId: id['adjustment-in'], toNodeId: id.B2, quantity: '5',
      reason: 'aparecieron en el conteo',
    })).status).toBe(201);

    // El consumo no es una corrección, es un hecho físico: no lleva motivo.
    expect((await mover(juan, {
      productId: id.tor, fromNodeId: id.B3, toNodeId: id.consumption, quantity: '2',
    })).status).toBe(201);

    expect(await saldo(id.B2, id.tor)).toBe('125.000');
    expect(await saldo(id.B3, id.tor)).toBe('62.000');
  });

  it('6 · no se despacha lo que no hay (I-4)', async () => {
    const res = await mover(juan, {
      productId: id.tor, fromNodeId: id.B3, toNodeId: id.sale, quantity: '999',
    });
    expectProblem(res, { status: 422, type: 'insufficient-stock', pointer: '/quantity' });
    // El detalle nombra el sitio por su ruta legible, que es lo que se lee en pantalla.
    expect(res.body.detail).toContain('BOD-A/Z1/E3/B3');
    expect(res.body.errors[0]).toMatchObject({ available: '62.000', requested: '999.000' });
    expect(await saldo(id.B3, id.tor)).toBe('62.000');
  });

  it('7 · Criterio 7 · el error de Juan, y la compensación de Diego', async () => {
    // Eran diez cajas y Juan teclea cien.
    const error = await mover(juan, {
      productId: id.tor, fromNodeId: id['supplier-default'], toNodeId: id.B2, quantity: '100',
    });
    expect(error.status).toBe(201);
    expect(await saldo(id.B2, id.tor)).toBe('225.000');

    // Juan puede registrar, no puede corregir.
    expectProblem(await compensar(juan, error.body.movement.id, 'eran diez'),
      { status: 403, type: 'insufficient-role' });

    const arreglo = await compensar(diego, error.body.movement.id, 'eran diez, no cien');
    expect(arreglo.status).toBe(201);
    expect(arreglo.headers.location).toBe(`/v1/movements/${arreglo.body.movement.id}`);
    expect(arreglo.body.movement.reversesId).toBe(error.body.movement.id);
    expect(await saldo(id.B2, id.tor)).toBe('125.000');

    const bueno = await mover(juan, {
      productId: id.tor, fromNodeId: id['supplier-default'], toNodeId: id.B2, quantity: '10',
    });
    expect(bueno.status).toBe(201);
    id.recepcionBuena = bueno.body.movement.id;

    // I-13: un asiento se compensa una vez y solo una.
    expectProblem(await compensar(diego, error.body.movement.id, 'otra vez'),
      { status: 409, type: 'already-reversed' });

    // Los tres están en el histórico, y solo el del medio lleva `reversesId`:
    // el original y la corrección son asientos como cualquier otro.
    const hist = await t.http.get(`/v1/movements?nodeId=${id.B2}&limit=200`, asJuan());
    const ids = hist.body.data.map((m: { id: string }) => m.id);
    for (const m of [error.body.movement.id, arreglo.body.movement.id, bueno.body.movement.id]) {
      expect(ids).toContain(m);
    }
    const conReverses = hist.body.data.filter((m: { reversesId?: string }) => m.reversesId !== undefined);
    expect(conReverses).toHaveLength(1);
    expect(conReverses[0].reversesId).toBe(error.body.movement.id);

    expect(await saldo(id.B2, id.tor)).toBe('135.000');
  });

  it('8 · compensar sin stock: el sistema no inventa existencias', async () => {
    expect((await mover(juan, {
      productId: id.tor, fromNodeId: id.B2, toNodeId: id.B3, quantity: '135',
    })).status).toBe(201);

    const res = await compensar(diego, id.recepcionBuena!, 'el proveedor se la lleva');
    expectProblem(res, { status: 422, type: 'insufficient-stock' });
    expect(res.body.detail).toContain('BOD-A/Z1/E3/B2');
    expect(res.body.errors[0]).toMatchObject({ available: '0.000', requested: '10.000' });

    // La recepción sigue sin compensar: nadie apunta a ella.
    const hist = await t.http.get('/v1/movements?limit=200', asDiego());
    expect(hist.body.data.filter((m: { reversesId?: string }) => m.reversesId === id.recepcionBuena)).toHaveLength(0);

    // La salida correcta es traer el stock de vuelta primero.
    expect((await mover(juan, {
      productId: id.tor, fromNodeId: id.B3, toNodeId: id.B2, quantity: '135',
    })).status).toBe(201);
    expect(await saldo(id.B2, id.tor)).toBe('135.000');
    expect(await saldo(id.B3, id.tor)).toBe('62.000');
  });

  it('9 · el préstamo del taladro (I-9, I-11)', async () => {
    const recibirSerie = (nodeId: string) => mover(juan, {
      productId: id.tal, batchId: id.serie, fromNodeId: id['supplier-default'], toNodeId: nodeId, quantity: '1',
    });
    expect((await recibirSerie(id.B2)).status).toBe(201);
    // La misma serie no entra dos veces: una serie es una sola cosa.
    expectProblem(await recibirSerie(id.B3), { status: 422, type: 'serial-already-placed', pointer: '/batchId' });

    const prestamo = await mover(juan, {
      productId: id.tal, batchId: id.serie, fromNodeId: id.B2, toNodeId: id.juan,
      quantity: '1', dueAt: enDias(7),
    });
    expect(prestamo.status).toBe(201);
    expect(prestamo.body.movement.dueAt).toBeDefined();

    const abiertas = await t.http.get('/v1/stock/custodies', asJuan());
    expect(abiertas.status).toBe(200);
    expect(abiertas.body.data).toHaveLength(1);
    expect(abiertas.body.data[0]).toMatchObject({ pending: '1.000', overdue: false });
    expect(abiertas.body.data[0].checkOut.id).toBe(prestamo.body.movement.id);

    // Prestar la misma serie desde otro estante falla por saldo, no por I-9: la
    // guarda no se dispara porque el origen ya es custodiable, y quien contesta
    // es el CHECK de I-4.
    expectProblem(
      await mover(juan, {
        productId: id.tal, batchId: id.serie, fromNodeId: id.B3, toNodeId: id.juan,
        quantity: '1', dueAt: enDias(7),
      }),
      { status: 422, type: 'insufficient-stock' },
    );

    // Y un saco de arroz que ya venía tarde.
    expect((await mover(juan, {
      productId: id.arroz, fromNodeId: id['supplier-default'], toNodeId: id.B2, quantity: '10',
    })).status).toBe(201);
    const tarde = await mover(juan, {
      productId: id.arroz, fromNodeId: id.B2, toNodeId: id.juan, quantity: '4', dueAt: enDias(-1),
    });
    expect(tarde.status).toBe(201);
    id.prestamoArroz = tarde.body.movement.id;

    const vencidas = await t.http.get('/v1/stock/custodies?overdueOnly=true', asJuan());
    expect(vencidas.body.data).toHaveLength(1);
    expect(vencidas.body.data[0]).toMatchObject({ pending: '4.000', overdue: true });
    expect(vencidas.body.data[0].checkOut.id).toBe(id.prestamoArroz);
  });

  it('10 · préstamo por cantidad y devolución parcial (I-17, I-18)', async () => {
    const prestamo = await mover(juan, {
      productId: id.tor, fromNodeId: id.B2, toNodeId: id.juan, quantity: '5', dueAt: enDias(7),
    });
    expect(prestamo.status).toBe(201);
    const prestamoId = prestamo.body.movement.id;

    const devolver = (over: Record<string, unknown>) => mover(juan, {
      productId: id.tor, fromNodeId: id.juan, toNodeId: id.B2, ...over,
    });

    expect((await devolver({ quantity: '2', settlesId: prestamoId })).status).toBe(201);

    const abiertas = await t.http.get(`/v1/stock/custodies?nodeId=${id.juan}&limit=50`, asJuan());
    const mio = abiertas.body.data.find((r: { checkOut: { id: string } }) => r.checkOut.id === prestamoId);
    expect(mio.pending).toBe('3.000');

    // Quedan tres y se intentan devolver cuatro: el error dice cuántas quedan.
    const exceso = await devolver({ quantity: '4', settlesId: prestamoId });
    expectProblem(exceso, { status: 422, type: 'settles-exceeded', pointer: '/quantity' });
    expect(exceso.body.errors[0]).toMatchObject({ pending: '3.000', requested: '4.000' });

    // I-17: de una custodia no se sale sin decir qué préstamo se salda.
    expectProblem(await devolver({ quantity: '1' }),
      { status: 422, type: 'settles-required', pointer: '/settlesId' });

    // Y el préstamo que se dice saldar tiene que ser de lo mismo.
    expectProblem(await devolver({ quantity: '1', settlesId: id.prestamoArroz }),
      { status: 422, type: 'settles-mismatch', pointer: '/settlesId' });

    expect(await saldo(id.B2, id.tor)).toBe('132.000');
    expect(await saldo(id.juan, id.tor)).toBe('3.000');
    expect((await t.http.get('/v1/stock/custodies?limit=50', asJuan())).body.data).toHaveLength(3);
  });

  it('11 · las ocho reglas del asiento', async () => {
    const desdeB2 = (over: Record<string, unknown>) => mover(juan, {
      productId: id.tor, fromNodeId: id.B2, toNodeId: id.B3, quantity: '1', ...over,
    });
    const delProveedor = (over: Record<string, unknown>) => mover(juan, {
      fromNodeId: id['supplier-default'], toNodeId: id.B2, quantity: '1', ...over,
    });

    expectProblem(await desdeB2({ toNodeId: id.B2 }), { status: 422, type: 'same-node' });
    expectProblem(await desdeB2({ quantity: '0' }), { status: 422, type: 'non-positive-quantity' });
    // Un plazo de devolución solo tiene sentido hacia una custodia (I-11).
    expectProblem(await desdeB2({ dueAt: enDias(7) }), { status: 422, type: 'due-date-not-allowed' });
    // La tolerancia de reloj son cinco minutos, y diez no caben (I-14).
    expectProblem(await desdeB2({ occurredAt: new Date(Date.now() + 10 * 60_000).toISOString() }),
      { status: 422, type: 'future-occurrence' });
    // I-8, por sus dos lados.
    expectProblem(await delProveedor({ productId: id.leche }), { status: 422, type: 'batch-required' });
    expectProblem(await delProveedor({ productId: id.tor, batchId: id.serie }),
      { status: 422, type: 'batch-not-allowed' });
    expectProblem(await delProveedor({ productId: id.leche, batchId: id.serie }),
      { status: 422, type: 'batch-product-mismatch' });

    // Y el octavo necesita romper el mundo, así que va el último. Desactivar un
    // nodo comprueba el saldo antes que los hijos (N-3 antes que D-30), de modo
    // que primero hay que vaciarlo de verdad.
    expect((await mover(juan, {
      productId: id.tor, fromNodeId: id.B3, toNodeId: id.B2, quantity: '62',
    })).status).toBe(201);
    expect((await t.http.del(`/v1/nodes/${id.B3}`, asDiego())).status).toBe(204);
    expectProblem(await desdeB2({ quantity: '1' }), { status: 422, type: 'node-inactive' });

    expect(await saldo(id.B2, id.tor)).toBe('194.000');
    expect(await saldo(id.B3, id.tor)).toBe('0.000');
  });

  it('12 · el catálogo respeta el ledger', async () => {
    // C-8 / I-15: la forma de seguimiento de un producto con historia no cambia,
    // porque cambiarla reinterpretaría los asientos que ya están escritos.
    const modo = await t.http.patch(`/v1/products/${id.tor}`, { trackingMode: 'LOT' },
      { ...asDiego(), ifMatch: 1 });
    expectProblem(modo, { status: 422, type: 'tracking-mode-locked' });
    expect(modo.body.movements).toBeGreaterThan(200);

    // C-9: y no se retira del catálogo lo que todavía está en una estantería.
    const retirar = await t.http.del(`/v1/products/${id.tor}`, asDiego());
    expectProblem(retirar, { status: 422, type: 'product-has-stock' });
    expect(retirar.body.nodes.map((n: { path: string }) => n.path)).toContain('BOD-A/Z1/E3/B2');
    expect(retirar.body.detail).toContain('BOD-A/Z1/E3/B2');

    // N-3: ni se desactiva el sitio donde está.
    const nodo = await t.http.del(`/v1/nodes/${id.B2}`, asDiego());
    expectProblem(nodo, { status: 422, type: 'node-has-stock' });
    expect(nodo.body.positions.length).toBeGreaterThan(0);
    expect(nodo.body.truncated).toBe(false);
  });

  it('13 · Criterio 9 · el reintento no duplica el saldo', async () => {
    const clave = crypto.randomUUID();
    const cuerpo = {
      productId: id.tor, fromNodeId: id['supplier-default'], toNodeId: id.B2,
      quantity: '3', occurredAt: ahora(),
    };
    const primera = await t.http.post('/v1/movements', cuerpo, { ...asJuan(), idem: clave });
    expect(primera.status).toBe(201);
    asientos.add(primera.body.movement.id);

    // La red se cayó y el móvil reintenta: la misma clave, el mismo cuerpo.
    const replay = await t.http.post('/v1/movements', cuerpo, { ...asJuan(), idem: clave });
    expect(replay.status).toBe(201);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body.movement.id).toBe(primera.body.movement.id);

    // Y esto es lo que de verdad prueba I-7 sobre un ledger: el saldo no subió dos veces.
    expect(await saldo(id.B2, id.tor)).toBe('197.000');

    // El id de cliente es único aunque la clave sea otra.
    expectProblem(
      await t.http.post('/v1/movements', { ...cuerpo, id: primera.body.movement.id }, asJuan()),
      { status: 409, type: 'movement-id-taken' },
    );
  });

  it('14 · Criterio 8 · Marta reconcilia el histórico contra el saldo', async () => {
    const clave = (nodeId: string, productId: string, batchId?: string) => `${nodeId}|${productId}|${batchId ?? ''}`;
    const suma = (m: Map<string, bigint>, k: string, d: bigint) => m.set(k, (m.get(k) ?? 0n) + d);
    /** Ordenado y en milésimas: lo que se lee en el diff cuando algo no cuadra. */
    const tabla = (m: Map<string, bigint>) =>
      Object.fromEntries([...m].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, fmt(v)]));

    // ── El libro mayor, reconstruido asiento a asiento.
    const libro = new Map<string, bigint>();
    const vistos = new Set<string>();
    let cursor: string | undefined;
    let paginas = 0;
    let ultima: { hasMore: boolean } = { hasMore: true };
    do {
      const page = await t.http.get(
        `/v1/movements?limit=200${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
        asMarta(),
      );
      expect(page.status).toBe(200);
      for (const m of page.body.data) {
        expect(vistos.has(m.id)).toBe(false); // el cursor ni repite ni salta
        vistos.add(m.id);
        expect(m.recordedAt >= m.occurredAt).toBe(true);
        const q = milli(m.quantity);
        suma(libro, clave(m.fromNodeId, m.productId, m.batchId), -q);
        suma(libro, clave(m.toNodeId, m.productId, m.batchId), q);
      }
      ultima = page.body.page;
      cursor = page.body.page.nextCursor;
      paginas++;
    } while (cursor !== undefined && paginas < 10);
    expect(ultima.hasMore).toBe(false);
    expect(paginas).toBe(2);

    // Ni sobra ni falta: el histórico es exactamente lo que la narrativa escribió.
    // Un asiento fantasma —uno que un 422 hubiera dejado escrito— saldría aquí.
    expect([...vistos].sort()).toEqual([...asientos].sort());

    // ── El saldo, leído tal cual, con los ceros y la frontera incluidos.
    const saldos = new Map<string, bigint>();
    cursor = undefined;
    paginas = 0;
    do {
      const page = await t.http.get(
        `/v1/stock?nonZeroOnly=false&custodialOnly=false&limit=200${cursor === undefined ? '' : `&cursor=${encodeURIComponent(cursor)}`}`,
        asMarta(),
      );
      expect(page.status).toBe(200);
      for (const p of page.body.data) saldos.set(clave(p.nodeId, p.productId, p.batchId), milli(p.quantity));
      cursor = page.body.page.nextCursor;
      paginas++;
    } while (cursor !== undefined && paginas < 10);

    // ── Fila por fila, las dos lecturas cuentan la misma historia (I-5).
    expect(tabla(libro)).toEqual(tabla(saldos));

    // ── Y nada se creó ni se destruyó: la conservación es la frontera.
    const porProducto = new Map<string, bigint>();
    for (const [k, v] of saldos) suma(porProducto, k.split('|')[1]!, v);
    expect(porProducto.size).toBe(4);
    for (const [, total] of porProducto) expect(fmt(total)).toBe('0.000');

    // ── El libro mayor del día, con nombre y apellido.
    const tor = await t.http.get(
      `/v1/stock?productId=${id.tor}&nonZeroOnly=false&custodialOnly=false&limit=200`, asMarta());
    expect(Object.fromEntries(tor.body.data.map((p: { nodeId: string; quantity: string }) => [p.nodeId, p.quantity])))
      .toEqual({
        [id.B1]: '100.000',
        [id.B2]: '197.000',
        [id.B3]: '0.000',
        [id.MUELLE]: '0.000',
        [id.juan]: '3.000',
        [id.sale]: '15.000',
        [id.shrinkage]: '1.000',
        [id.consumption]: '2.000',
        [id['adjustment-in']]: '-5.000',
        [id['opening-balance']]: '-200.000',
        [id['supplier-default']]: '-113.000',
      });
  });

  it('15 · Sofía solo mira', async () => {
    expectProblem(
      await t.http.post('/v1/movements', {
        productId: id.tor, fromNodeId: id['supplier-default'], toNodeId: id.B2,
        quantity: '1', occurredAt: ahora(),
      }, { token: sofia.token }),
      { status: 403, type: 'insufficient-role' },
    );
    expect((await t.http.get('/v1/movements', { token: sofia.token })).status).toBe(200);
    expect((await t.http.get('/v1/stock', { token: sofia.token })).status).toBe(200);
  });

  it('16 · el ledger de otra empresa no existe para esta', async () => {
    const otra = await registerOrg(t.http, {});
    expect((await t.http.get('/v1/movements', { token: otra.owner.token })).body.data).toEqual([]);
    expect((await t.http.get('/v1/stock?nonZeroOnly=false', { token: otra.owner.token })).body.data).toEqual([]);
    // Un recurso de otra organización es un 404, nunca un 403: decir «no puedes»
    // ya sería decir «existe».
    expectProblem(
      await t.http.get(`/v1/movements/${[...asientos][0]}`, { token: otra.owner.token }),
      { status: 404, type: 'not-found' },
    );
  });
});
