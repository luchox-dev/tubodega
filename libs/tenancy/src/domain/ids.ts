import { err, ok, type Branded, type Result } from '@app/common';
import { InvalidEmailError, InvalidSlugError } from './errors.js';

/** Normalised to lower case (spec 10 §2). */
export type Email = Branded<string, 'Email'>;
/** Lower case, digits and hyphens, 3-64 characters, no leading/trailing hyphen. */
export type Slug = Branded<string, 'Slug'>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,62}[a-z0-9])$/;

export const Email = {
  of(raw: string): Result<Email, InvalidEmailError> {
    const value = raw.trim().toLowerCase();
    return EMAIL_RE.test(value) ? ok(value as Email) : err(new InvalidEmailError(raw));
  },
};

export const Slug = {
  of(raw: string): Result<Slug, InvalidSlugError> {
    return SLUG_RE.test(raw) ? ok(raw as Slug) : err(new InvalidSlugError(raw));
  },
};
