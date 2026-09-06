// A fictional business per suite (spec plan, part C §5): Distribuidora La
// Esquina — Marta (OWNER), Diego (ADMIN), Juan (OPERATOR), Sofía (VIEWER).
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import type { TestHttp } from './http.js';

export interface Session {
  readonly token: string;
  readonly refreshToken: string;
  readonly userId: string;
  readonly email: string;
  readonly password: string;
}

export interface Tenant {
  readonly slug: string;
  readonly orgId: string;
  readonly owner: Session;
}

export const PASSWORD = 'correcthorse1!';

export async function login(http: TestHttp, email: string, password: string, slug?: string): Promise<Session> {
  const res = await http.post('/v1/auth/login', { email, password, slug }, { idem: false });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { token: res.body.accessToken, refreshToken: res.body.refreshToken, userId: res.body.user.id, email, password };
}

/** Registers a fresh organization with a random slug (the test database is never cleaned). */
export async function registerOrg(
  http: TestHttp,
  o: { slug?: string; ownerEmail?: string; name?: string } = {},
): Promise<Tenant> {
  const slug = o.slug ?? `la-esquina-${randomBytes(4).toString('hex')}`;
  const email = o.ownerEmail ?? `marta-${slug}@esquina.co`;
  const res = await http.post(
    '/v1/organizations',
    { name: o.name ?? 'Distribuidora La Esquina', slug, owner: { email, name: 'Marta', password: PASSWORD } },
    { idem: false },
  );
  if (res.status !== 201) throw new Error(`registerOrg failed: ${res.status} ${JSON.stringify(res.body)}`);
  const owner = await login(http, email, PASSWORD, slug);
  return { slug, orgId: res.body.organization.id, owner };
}

/** An access token whose exp is in the past, signed with the test secret. Never touches the database. */
export async function expiredToken(s: Session, orgId: string): Promise<string> {
  const key = new TextEncoder().encode(process.env.JWT_SECRET);
  const past = Math.floor(Date.now() / 1000) - 3600;
  return new SignJWT({ org: orgId, roles: ['OWNER'] })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(s.userId)
    .setIssuedAt(past - 900)
    .setExpirationTime(past)
    .sign(key);
}
