import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { catchError, concatMap, from, switchMap, throwError, type Observable } from 'rxjs';
import { DomainError } from '@app/common';
import { canonicalHash } from './canonical-hash.js';
import { IdempotencyStore } from './idempotency.store.js';
import { IS_IDEMPOTENCY_EXEMPT } from './idempotency-exempt.decorator.js';
import { IS_PUBLIC } from './public.decorator.js';
import { requestState } from './request-state.js';

export class MissingIdempotencyKeyError extends DomainError {
  readonly type = 'missing-idempotency-key';
  readonly status = 400;
  constructor() {
    super('Este POST exige la cabecera Idempotency-Key');
  }
}

export class IdempotencyKeyReuseError extends DomainError {
  readonly type = 'idempotency-key-reuse';
  readonly status = 409;
  constructor() {
    super('Esa Idempotency-Key ya se usó con un cuerpo distinto');
  }
}

export class IdempotencyKeyInFlightError extends DomainError {
  readonly type = 'idempotency-key-in-flight';
  readonly status = 409;
  constructor() {
    super('Una petición con esa Idempotency-Key sigue en curso');
  }
}

const MAX_KEY_LENGTH = 128;

/**
 * Step 5 of spec 07 §3, driving the A/B/C sequence of §5. It runs *inside* the
 * transaction interceptor, which is why the store needs a connection of its
 * own for the reservation (decision D-9).
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly store: IdempotencyStore,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    if (req.method !== 'POST' || this.isExempt(context)) return next.handle();

    const state = requestState(req);
    const orgId = state.claims!.org;
    const raw = req.headers['idempotency-key'];
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!key || key.length > MAX_KEY_LENGTH) throw new MissingIdempotencyKeyError();
    const hash = canonicalHash(req.body);

    return from(this.store.reserve(orgId, key, hash)).pipe(
      switchMap((reservation) => {
        if (reservation.outcome === 'in-flight') throw new IdempotencyKeyInFlightError();
        if (reservation.outcome === 'completed') {
          if (reservation.requestHash !== hash) throw new IdempotencyKeyReuseError();
          return from(this.replay(context, reservation.responseCode, reservation.responseBody));
        }
        // The confirmation is awaited inside the stream, so it lands in the
        // ambient transaction before the transaction interceptor commits.
        return next.handle().pipe(
          concatMap(async (body) => {
            await this.store.complete(orgId, key, this.statusOf(context), body ?? null);
            return body;
          }),
          catchError((e: unknown) =>
            from(this.store.release(orgId, key)).pipe(switchMap(() => throwError(() => e))),
          ),
        );
      }),
    );
  }

  private isExempt(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    return (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) === true ||
      this.reflector.getAllAndOverride<boolean>(IS_IDEMPOTENCY_EXEMPT, targets) === true
    );
  }

  /**
   * Only code and body are replayed, which is what the table stores: a
   * `Location` header is not reconstructed, and the body already carries the id.
   */
  private async replay(context: ExecutionContext, code: number, body: unknown): Promise<unknown> {
    const reply = context.switchToHttp().getResponse<FastifyReply>();
    void reply.status(code).header('Idempotency-Replayed', 'true');
    return body;
  }

  /**
   * The status Nest *will* send. It cannot be read off the reply yet: the
   * adapter applies it after the interceptor chain resolves, which is after
   * the transaction has to commit. Only POSTs reach here, so the default is 201.
   */
  private statusOf(context: ExecutionContext): number {
    return this.reflector.get<number | undefined>(HTTP_CODE_METADATA, context.getHandler()) ?? 201;
  }
}
