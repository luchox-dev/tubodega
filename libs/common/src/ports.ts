import type { DomainEvent } from './events.js';

/** A port and not `new Date()`: expiry and overdue rules must be testable with a fixed clock. */
export interface Clock {
  now(): Date;
}

/** UUIDv7. */
export interface IdGenerator {
  next(): string;
}

/**
 * The only contact `application/` has with transactions (spec 07 §4). The edge
 * opens the root transaction; use cases only nest. A nested `run()` is a
 * SAVEPOINT; outside any transaction it throws (decision D-13).
 */
export interface UnitOfWork {
  run<T>(fn: () => Promise<T>, opts?: { readonly readOnly?: boolean }): Promise<T>;
}

export interface EventPublisher {
  publish(events: readonly DomainEvent[]): Promise<void>;
}

export const CLOCK = Symbol('Clock');
export const ID_GENERATOR = Symbol('IdGenerator');
export const UNIT_OF_WORK = Symbol('UnitOfWork');
export const EVENT_PUBLISHER = Symbol('EventPublisher');
