import { v7 } from 'uuid';
import type { IdGenerator } from '../ports.js';

export class Uuidv7Generator implements IdGenerator {
  next(): string {
    return v7();
  }
}
