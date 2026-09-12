import type { StorageKey } from '@app/catalog';
import type { StepId } from './ids.js';
import type { StepPayload } from './step-types.js';
import type { MovementDraft } from './drafts.js';

export interface RehydrateContextProps {
  readonly values: ReadonlyMap<StepId, StepPayload | null>;
  readonly draft: MovementDraft;
  readonly storageKeys: readonly StorageKey[];
}

/**
 * What a process has accumulated so far. Immutable: every method returns a new
 * context, which is what makes the engine provable by feeding it a template and
 * a sequence of payloads and looking at what comes out.
 *
 * The three fields are three different things, and keeping them apart is the
 * point: `values` is the record of what was captured (a step omitted is stored
 * as `null`, which is not the same as absent); `draft` is the single movement
 * being built; `storageKeys` are the photos, which are not part of the movement.
 */
export class ProcessContext {
  private constructor(
    readonly values: ReadonlyMap<StepId, StepPayload | null>,
    readonly draft: MovementDraft,
    readonly storageKeys: readonly StorageKey[],
  ) {}

  static empty(): ProcessContext {
    return new ProcessContext(new Map(), {}, []);
  }

  static rehydrate(p: RehydrateContextProps): ProcessContext {
    return new ProcessContext(new Map(p.values), { ...p.draft }, [...p.storageKeys]);
  }

  with(stepId: StepId, payload: StepPayload | null): ProcessContext {
    const values = new Map(this.values);
    values.set(stepId, payload);
    return new ProcessContext(values, this.draft, this.storageKeys);
  }

  /**
   * **Merges.** Spec 13 §3 says an instance produces at most one movement, so
   * each step contributes its own field over the same draft — the scan the
   * product, the quantity step the quantity, the location step the destination.
   * The day of the multi-line instance (spec 90 §12) this becomes a list again,
   * and `CONFIRM` already emits a list of drafts.
   */
  withDraft(patch: Partial<MovementDraft>): ProcessContext {
    return new ProcessContext(this.values, { ...this.draft, ...patch }, this.storageKeys);
  }

  withStorageKeys(keys: readonly StorageKey[]): ProcessContext {
    return new ProcessContext(this.values, this.draft, [...this.storageKeys, ...keys]);
  }
}
