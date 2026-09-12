import { StepType } from '../step-types.js';
import { mvpRegistry } from './index.js';
import { StepHandlerRegistry } from './registry.js';
import { ScanItemHandler } from './scan-item.js';

describe('StepHandlerRegistry', () => {
  it('devuelve el manejador registrado, y null para un tipo sin él', () => {
    const r = new StepHandlerRegistry();
    r.register(new ScanItemHandler());
    expect(r.get(StepType.SCAN_ITEM)).toBeInstanceOf(ScanItemHandler);
    expect(r.get(StepType.CONFIRM)).toBeNull();
  });

  // Añadir INSPECCION_CALIDAD es escribir una clase y registrarla. El motor no
  // se edita nunca: ni al añadir un paso, ni al añadir un proceso.
  it('el registro del MVP tiene los ocho tipos, y cada uno el suyo', () => {
    const r = mvpRegistry();
    for (const type of Object.values(StepType)) {
      expect(r.get(type)?.type, type).toBe(type);
    }
  });
});
