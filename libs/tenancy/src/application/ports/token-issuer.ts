import type { TokenClaims } from '../../domain/request-context.js';
import type { User } from '../../domain/user.js';

export type TokenVerification =
  | { readonly ok: true; readonly claims: TokenClaims }
  | { readonly ok: false; readonly reason: 'expired' | 'invalid' };

export interface TokenIssuer {
  issueAccess(user: User): Promise<string>;
  verify(token: string): Promise<TokenVerification>;
}
export const TOKEN_ISSUER = Symbol('TokenIssuer');

/** Unpredictable opaque tokens (refresh). Not the IdGenerator: UUIDv7 is guessable. */
export interface RandomToken {
  next(): string;
}
export const RANDOM_TOKEN = Symbol('RandomToken');
