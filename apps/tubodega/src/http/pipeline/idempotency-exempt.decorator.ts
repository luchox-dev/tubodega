import { SetMetadata } from '@nestjs/common';

export const IS_IDEMPOTENCY_EXEMPT = 'tubodega:idempotency-exempt';

/**
 * For the POSTs of the closed list of spec 07 §5 that are authenticated:
 * today only `POST /v1/auth/logout`. The `@Public()` ones are exempt
 * implicitly — the table is indexed by organization and they run before one
 * exists.
 */
export const IdempotencyExempt = () => SetMetadata(IS_IDEMPOTENCY_EXEMPT, true);
