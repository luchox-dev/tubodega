import type { Branded } from './brand.js';

/** Opaque, base64url cursor (spec 03 §6). Clients never interpret it. */
export type Cursor = Branded<string, 'Cursor'>;

export interface Page<T> {
  readonly data: readonly T[];
  readonly nextCursor?: Cursor;
  readonly hasMore: boolean;
}

export type CursorParts = readonly (string | number | null)[];

export const encodeCursor = (parts: CursorParts): Cursor =>
  Buffer.from(JSON.stringify(parts)).toString('base64url') as Cursor;

export function decodeCursor(cursor: Cursor): CursorParts | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return Array.isArray(value) ? (value as CursorParts) : null;
  } catch {
    return null;
  }
}
