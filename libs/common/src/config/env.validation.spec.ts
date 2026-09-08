import { NodeEnv, durationToMs, validate } from './env.validation.js';

const base = {
  DATABASE_URL: 'postgresql://tubodega_app:app@localhost:5432/tubodega',
  DATABASE_URL_SYSTEM: 'postgresql://tubodega_system:system@localhost:5432/tubodega',
  DATABASE_URL_MIGRATOR: 'postgresql://tubodega_migrator:migrator@localhost:5432/tubodega',
  JWT_SECRET: 'x'.repeat(32),
};

describe('validate(env)', () => {
  it('applies defaults', () => {
    const env = validate(base);
    expect(env.NODE_ENV).toBe(NodeEnv.Development);
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_POOL_SIZE).toBe(10);
    expect(env.JWT_ACCESS_TTL).toBe('15m');
    expect(env.JWT_REFRESH_TTL).toBe('30d');
    expect(env.SHADOW_DATABASE_URL).toBeUndefined();
    expect(env.OUTBOX_INTERVAL_MS).toBe(1000);
  });

  it('coerces numbers from strings', () => {
    const env = validate({ ...base, PORT: '8080', DATABASE_POOL_SIZE: '4', OUTBOX_INTERVAL_MS: '250' });
    expect(env.PORT).toBe(8080);
    expect(env.DATABASE_POOL_SIZE).toBe(4);
    expect(env.OUTBOX_INTERVAL_MS).toBe(250);
  });

  it.each([
    ['PORT', 'not-a-number'],
    ['NODE_ENV', 'staging'],
    ['DATABASE_URL', 'mysql://x'],
    ['JWT_SECRET', 'short'],
    ['JWT_ACCESS_TTL', '15 minutes'],
    ['OUTBOX_INTERVAL_MS', '50'],
  ])('rejects invalid %s', (key, value) => {
    expect(() => validate({ ...base, [key]: value })).toThrow(/Invalid environment variables/);
  });

  it('requires the three database URLs and the secret', () => {
    expect(() => validate({})).toThrow(/DATABASE_URL/);
  });
});

describe('durationToMs', () => {
  it.each([
    ['500ms', 500],
    ['15m', 900_000],
    ['2h', 7_200_000],
    ['30d', 2_592_000_000],
  ])('%s → %d', (v, ms) => expect(durationToMs(v)).toBe(ms));
});
