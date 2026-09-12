import type { StepType } from '../step-types.js';
import type { StepHandler } from './handler.js';

/**
 * A registry and not a `switch`: adding `INSPECCION_CALIDAD` is writing a class
 * and registering it. **The engine is never edited** — not to add a step, not
 * to add a process, not when the workflow arrives. It is the property this
 * module exists to guarantee.
 */
export class StepHandlerRegistry {
  private readonly byType = new Map<StepType, StepHandler>();

  register(handler: StepHandler): void {
    this.byType.set(handler.type, handler);
  }

  get(type: StepType): StepHandler | null {
    return this.byType.get(type) ?? null;
  }
}
