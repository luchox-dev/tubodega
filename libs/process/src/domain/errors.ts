import { DomainError } from '@app/common';

/**
 * The errors of spec 13 §12. The ones about instances are declared here even
 * though plan 8 is what raises them: a module's error file is written once.
 *
 * `upload-not-found` is deliberately NOT here. It already exists as
 * `UploadNotFoundError` of `@app/catalog`, raised by `AttachMedia` for exactly
 * this condition, and spec 13 §12 asks for the *same* `type` so a client
 * retrying an upload does not have to learn two names for one problem. A twin
 * class would be a second name that ages apart from the first (decision D-46).
 */

/**
 * Not in the table of spec 13 §12, and needed anyway: `TemplateCode.of` has to
 * be able to refuse. The edge never surfaces it — a code that cannot exist is
 * `template-not-found`, because `/v1/process-templates/{code}` answering 422
 * would be telling the client about a column width. Declared as a deviation in
 * the plan-7 document, like `invalid-quantity` was in plan 5.
 */
export class InvalidTemplateCodeError extends DomainError {
  readonly type = 'invalid-template-code';
  readonly status = 422;
  constructor(raw: string) {
    super(`"${raw}" no es un código de plantilla válido: de 1 a 64 caracteres, sin barras`, {
      errors: [{ pointer: '/code', code: 'invalid-template-code' }],
    });
  }
}

export class TemplateNotFoundError extends DomainError {
  readonly type = 'template-not-found';
  readonly status = 404;
  constructor(code: string) {
    super(`No hay ninguna versión activa de la plantilla "${code}"`);
  }
}

/** I-6: a process of another organization is not there, and never a 403. */
export class ProcessInstanceNotFoundError extends DomainError {
  readonly type = 'process-instance-not-found';
  readonly status = 404;
  constructor() {
    super('No se encontró el proceso');
  }
}

/**
 * The mould of `movement-id-taken` (spec 12 §9): `StartProcess` accepts an id
 * from the client, so it can hit the primary key with a different
 * Idempotency-Key, and a bare PK clash would surface as a 500.
 */
export class ProcessInstanceIdTakenError extends DomainError {
  readonly type = 'process-instance-id-taken';
  readonly status = 409;
  constructor(id: string) {
    super(`Ya existe un proceso con el id "${id}"`);
  }
}

/** P-4. A finished process does not get edited; it gets read. */
export class InstanceClosedError extends DomainError {
  readonly type = 'instance-closed';
  readonly status = 409;
  constructor(state: string) {
    super(`El proceso ya está ${state === 'CANCELLED' ? 'cancelado' : 'terminado'} y no admite más pasos`);
  }
}

/**
 * P-2. The detail names the current step, because the client that got here is
 * one that fell behind, and what it needs is to know where the process is.
 */
export class WrongStepError extends DomainError {
  readonly type = 'wrong-step';
  readonly status = 409;
  constructor(attempted: string, current: string | undefined) {
    super(
      current === undefined
        ? `El proceso no está esperando ningún paso, y llegó "${attempted}"`
        : `El proceso está en el paso "${current}", y llegó "${attempted}"`,
      { extensions: { currentStepId: current ?? null } },
    );
  }
}

/** P-3, the domain half of the `UNIQUE (org_id, instance_id, step_id)`. */
export class StepAlreadyCompletedError extends DomainError {
  readonly type = 'step-already-completed';
  readonly status = 409;
  constructor(stepId: string) {
    super(`El paso "${stepId}" ya se completó una vez, y se completa una sola`);
  }
}

/** P-5. Omitting a step is completing it with a null payload, and this one says no. */
export class RequiredStepSkippedError extends DomainError {
  readonly type = 'required-step-skipped';
  readonly status = 422;
  constructor(stepId: string) {
    super(`El paso "${stepId}" es obligatorio y no se puede omitir`);
  }
}

/** `parse` or `validate` said no. Reserved for a payload the handler cannot read. */
export class InvalidStepPayloadError extends DomainError {
  readonly type = 'invalid-step-payload';
  readonly status = 422;
  constructor(pointer: string, detail: string) {
    super(detail, { errors: [{ pointer, code: 'invalid-step-payload' }] });
  }
}

/** `CONFIRM` with a draft that is not a movement yet. The detail lists what is missing. */
export class IncompleteDraftError extends DomainError {
  readonly type = 'incomplete-draft';
  readonly status = 422;
  constructor(missing: readonly string[]) {
    super(`Al movimiento le falta ${missing.join(', ')}`, { extensions: { missing: [...missing] } });
  }
}

/**
 * `CAPTURE_BATCH` omitted on a product that tracks batches. The step is
 * optional in the template because the template does not know what product is
 * going to go through it; the handler does (spec 13 §4.2).
 */
export class BatchStepRequiredError extends DomainError {
  readonly type = 'batch-step-required';
  readonly status = 422;
  constructor(sku: string, mode: string) {
    super(`"${sku}" se rastrea por ${mode === 'SERIAL' ? 'número de serie' : 'lote'}: hay que decir cuál`);
  }
}

/** The other half: a QUANTITY product has no batches to speak of. */
export class BatchStepNotAllowedError extends DomainError {
  readonly type = 'batch-step-not-allowed';
  readonly status = 422;
  constructor(sku: string) {
    super(`"${sku}" se lleva por cantidad, así que este paso se omite`);
  }
}

/** The template names a type nobody knows how to run. */
export class UnknownStepTypeError extends DomainError {
  readonly type = 'unknown-step-type';
  readonly status = 422;
  constructor(given: string) {
    super(`"${given}" no es un tipo de paso conocido`, {
      errors: [{ pointer: '/steps', code: 'unknown-step-type' }],
    });
  }
}

/**
 * P-8. It earns an explicit message and not a generic failure: it is the signal
 * that somebody reached the limit of the MVP, and the message has to say that
 * the capability is foreseen and what is missing for it (spec 13 §12).
 */
export class BranchingNotSupportedError extends DomainError {
  readonly type = 'branching-not-supported';
  readonly status = 422;
  constructor(stepId: string) {
    super(
      `El paso "${stepId}" tiene más de una transición. Los flujos con ramas están previstos —el esquema ya los admite— y les falta el motor que evalúa condiciones; hoy cada paso lleva exactamente una`,
      { errors: [{ pointer: '/steps', code: 'branching-not-supported' }] },
    );
  }
}

/**
 * The boring sibling of `branching-not-supported`, and just as necessary:
 * `unknown-step-type` covers the type nobody can run and branching covers the
 * fork, but a template whose `confirmar` transitions to a misspelled id passes
 * both and **gets seeded broken**. The failure would show up weeks later, in
 * somebody's instance, as a 500.
 */
export class InvalidTemplateError extends DomainError {
  readonly type = 'invalid-template';
  readonly status = 422;
  constructor(reason: string) {
    super(`La plantilla no es ejecutable: ${reason}`, {
      errors: [{ pointer: '/steps', code: 'invalid-template' }],
    });
  }
}

/** P-9. A template with instances is not modified; it is versioned. */
export class TemplateHasInstancesError extends DomainError {
  readonly type = 'template-has-instances';
  readonly status = 409;
  constructor(code: string, version: number) {
    super(`La versión ${version} de "${code}" ya tiene procesos: crea una versión nueva en vez de editarla`);
  }
}
