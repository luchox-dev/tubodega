import {
  BatchStepNotAllowedError, BatchStepRequiredError, BranchingNotSupportedError,
  IncompleteDraftError, InstanceClosedError, InvalidStepPayloadError, InvalidTemplateError,
  ProcessInstanceIdTakenError, ProcessInstanceNotFoundError, RequiredStepSkippedError,
  StepAlreadyCompletedError, TemplateHasInstancesError, TemplateNotFoundError,
  UnknownStepTypeError, WrongStepError,
} from './errors.js';

/**
 * Spec 13 §12 pide que dos de estos digan bastante más que "no": el de la rama,
 * porque quien llega ahí ha tocado el límite del MVP y hay que decirle que la
 * capacidad está prevista; y el del paso equivocado, porque quien llega ahí es
 * un cliente que se quedó atrás y lo que necesita es saber dónde está el proceso.
 * El texto es parte del contrato, así que se prueba como tal.
 */
describe('los errores del motor', () => {
  it('wrong-step nombra el paso actual, y lo deja también en extensions (P-2)', () => {
    const e = new WrongStepError('confirmar', 'cantidad');
    expect(e.status).toBe(409);
    expect(e.message).toBe('El proceso está en el paso "cantidad", y llegó "confirmar"');
    expect(e.extensions).toEqual({ currentStepId: 'cantidad' });
  });

  it('wrong-step sin paso actual tampoco miente', () => {
    const e = new WrongStepError('confirmar', undefined);
    expect(e.message).toBe('El proceso no está esperando ningún paso, y llegó "confirmar"');
    expect(e.extensions).toEqual({ currentStepId: null });
  });

  it('branching-not-supported dice que la capacidad está prevista y qué falta (P-8)', () => {
    const e = new BranchingNotSupportedError('confirmar');
    expect(e.status).toBe(422);
    expect(e.message).toContain('previstos');
    expect(e.message).toContain('condiciones');
    expect(e.errors?.[0]?.pointer).toBe('/steps');
  });

  it('incomplete-draft lista lo que falta, en el mensaje y aparte', () => {
    const e = new IncompleteDraftError(['el producto', 'la cantidad']);
    expect(e.message).toBe('Al movimiento le falta el producto, la cantidad');
    expect(e.extensions).toEqual({ missing: ['el producto', 'la cantidad'] });
  });

  it('instance-closed distingue cancelado de terminado (P-4)', () => {
    expect(new InstanceClosedError('CANCELLED').message).toContain('cancelado');
    expect(new InstanceClosedError('COMPLETED').message).toContain('terminado');
  });

  it('batch-step-required nombra la serie o el lote, según el modo', () => {
    expect(new BatchStepRequiredError('TAL-BOSCH', 'SERIAL').message).toContain('número de serie');
    expect(new BatchStepRequiredError('LECHE-1L', 'LOT').message).toContain('lote');
  });

  it('invalid-step-payload lleva el puntero de quien lo lanzó', () => {
    const e = new InvalidStepPayloadError('/quantity', 'La cantidad tiene que ser positiva');
    expect(e.message).toBe('La cantidad tiene que ser positiva');
    expect(e.errors?.[0]).toEqual({ pointer: '/quantity', code: 'invalid-step-payload' });
  });

  it('los demás llevan su estado y su tipo', () => {
    const casos: [{ type: string; status: number; message: string }, string, number][] = [
      [new TemplateNotFoundError('RECEPCION'), 'template-not-found', 404],
      [new ProcessInstanceNotFoundError(), 'process-instance-not-found', 404],
      [new ProcessInstanceIdTakenError('018f-…'), 'process-instance-id-taken', 409],
      [new StepAlreadyCompletedError('cantidad'), 'step-already-completed', 409],
      [new TemplateHasInstancesError('RECEPCION', 1), 'template-has-instances', 409],
      [new RequiredStepSkippedError('cantidad'), 'required-step-skipped', 422],
      [new BatchStepNotAllowedError('TOR-M8'), 'batch-step-not-allowed', 422],
      [new UnknownStepTypeError('INSPECCION'), 'unknown-step-type', 422],
      [new InvalidTemplateError('el paso "raro" no existe'), 'invalid-template', 422],
    ];
    for (const [e, type, status] of casos) {
      expect(e.type).toBe(type);
      expect(e.status).toBe(status);
      expect(e.message.length).toBeGreaterThan(10);
    }
  });
});
