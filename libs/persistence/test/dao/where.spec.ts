// The `where` DSL of spec 08 §5, one case per row of its table. No database:
// the pool is never connected, only `.compile()` is called.
import { CamelCasePlugin, Kysely, PostgresDialect } from 'kysely';
import pg from 'pg';
import type { DB } from '../../src/generated/db.js';
import { compileWhere, escapeLike, type WhereInput } from '../../src/dao/base/where.js';

const db = new Kysely<DB>({
  dialect: new PostgresDialect({ pool: new pg.Pool() }),
  plugins: [new CamelCasePlugin()],
});

afterAll(() => db.destroy());

/** The WHERE clause and its parameters, for a filter over `app_user`. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function compile(where: WhereInput<any>): { sql: string; parameters: readonly unknown[] } {
  const q = db
    .selectFrom('appUser')
    .selectAll()
    .where((eb) => compileWhere(eb, where))
    .compile();
  return { sql: q.sql.replace('select * from "app_user" where ', ''), parameters: q.parameters };
}

describe('compileWhere', () => {
  it('a plain value is equality', () => {
    expect(compile({ active: true })).toEqual({ sql: '"active" = $1', parameters: [true] });
  });

  it('a plain null is IS NULL', () => {
    expect(compile({ revokedAt: null }).sql).toBe('"revoked_at" is null');
  });

  it('{ equals } and { not } accept null too', () => {
    expect(compile({ email: { equals: 'a@b.co' } })).toEqual({ sql: '"email" = $1', parameters: ['a@b.co'] });
    expect(compile({ revokedAt: { equals: null } }).sql).toBe('"revoked_at" is null');
    expect(compile({ revokedAt: { not: null } }).sql).toBe('"revoked_at" is not null');
    expect(compile({ name: { not: 'x' } })).toEqual({ sql: '"name" != $1', parameters: ['x'] });
  });

  it('{ in } and { notIn }', () => {
    expect(compile({ role: { in: ['OWNER', 'ADMIN'] } })).toEqual({
      sql: '"role" in ($1, $2)',
      parameters: ['OWNER', 'ADMIN'],
    });
    expect(compile({ role: { notIn: ['VIEWER'] } })).toEqual({ sql: '"role" not in ($1)', parameters: ['VIEWER'] });
  });

  it('an empty { in } is FALSE, not a syntax error', () => {
    expect(compile({ role: { in: [] } })).toEqual({ sql: 'false', parameters: [] });
    expect(compile({ role: { notIn: [] } })).toEqual({ sql: 'true', parameters: [] });
  });

  it('comparisons', () => {
    const d = new Date('2026-09-07T00:00:00.000Z');
    expect(compile({ expiresAt: { lt: d } })).toEqual({ sql: '"expires_at" < $1', parameters: [d] });
    expect(compile({ expiresAt: { gte: d } })).toEqual({ sql: '"expires_at" >= $1', parameters: [d] });
  });

  it('text operators, case sensitive and insensitive', () => {
    expect(compile({ name: { contains: 'mart' } })).toEqual({ sql: '"name" like $1', parameters: ['%mart%'] });
    expect(compile({ name: { contains: 'mart', mode: 'insensitive' } })).toEqual({
      sql: '"name" ilike $1',
      parameters: ['%mart%'],
    });
    expect(compile({ name: { startsWith: 'B' } }).parameters).toEqual(['B%']);
    expect(compile({ name: { endsWith: 'z' } }).parameters).toEqual(['%z']);
  });

  it('escapes the LIKE wildcards of the value', () => {
    expect(escapeLike('50%_x')).toBe('50\\%\\_x');
    expect(escapeLike('a\\b')).toBe('a\\\\b');
    expect(compile({ name: { contains: '50%_x' } }).parameters).toEqual(['%50\\%\\_x%']);
  });

  it('several keys of one object are ANDed', () => {
    expect(compile({ active: true, name: 'x' })).toEqual({
      sql: '("active" = $1 and "name" = $2)',
      parameters: [true, 'x'],
    });
  });

  it('AND, OR and NOT', () => {
    expect(compile({ OR: [{ email: 'a' }, { name: { startsWith: 'B' } }] })).toEqual({
      sql: '("email" = $1 or "name" like $2)',
      parameters: ['a', 'B%'],
    });
    expect(compile({ NOT: { active: true } })).toEqual({ sql: 'not "active" = $1', parameters: [true] });
    expect(compile({ AND: [{ active: true }, { name: 'x' }] }).parameters).toEqual([true, 'x']);
  });

  it('an empty filter matches everything', () => {
    expect(compile({})).toEqual({ sql: 'true', parameters: [] });
  });

  it('a callback is the escape hatch and mixes with the DSL', () => {
    const { sql } = compile({
      active: true,
      AND: [
        (eb) =>
          eb.exists(
            eb.selectFrom('userRole').select('userId').whereRef('userRole.userId', '=', 'appUser.id'),
          ),
      ],
    });
    expect(sql).toBe(
      '("active" = $1 and exists (select "user_id" from "user_role" where "user_role"."user_id" = "app_user"."id"))',
    );
  });

  it('a top-level callback is used as is', () => {
    expect(compile((eb) => eb('active', '=', false)).sql).toBe('"active" = $1');
  });
});
