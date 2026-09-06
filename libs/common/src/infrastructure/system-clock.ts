import type { Clock } from '../ports.js';

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}
