import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { RandomToken } from '../application/ports/token-issuer.js';

/** 32 random bytes, base64url: the opaque refresh token (spec 10 §4). */
@Injectable()
export class CryptoRandomToken implements RandomToken {
  next(): string {
    return randomBytes(32).toString('base64url');
  }
}
