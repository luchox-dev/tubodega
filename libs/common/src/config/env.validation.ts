import { Transform, plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

const PG_URL = /^postgres(ql)?:\/\/.+/;
const DURATION = /^\d+(ms|s|m|h|d)$/;

/**
 * The validated shape of the environment. Anything the app reads through
 * `ConfigService` should be declared here so a bad value fails at boot rather
 * than at the first request that happens to touch it. See spec 07 §9.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Transform(({ value }) => (value === undefined ? 3000 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  /** Tenant pool, role `tubodega_app` (RLS enforced). */
  @Matches(PG_URL, { message: 'DATABASE_URL must be a postgres:// URL' })
  DATABASE_URL!: string;

  /** System pool, role `tubodega_system` (BYPASSRLS). */
  @Matches(PG_URL, { message: 'DATABASE_URL_SYSTEM must be a postgres:// URL' })
  DATABASE_URL_SYSTEM!: string;

  /** `prisma migrate deploy` before boot, role `tubodega_migrator`. */
  @Matches(PG_URL, { message: 'DATABASE_URL_MIGRATOR must be a postgres:// URL' })
  DATABASE_URL_MIGRATOR!: string;

  /** Development and CI only: shadow database for `migrate dev` / `db:check`. */
  @IsOptional()
  @Matches(PG_URL, { message: 'SHADOW_DATABASE_URL must be a postgres:// URL' })
  SHADOW_DATABASE_URL?: string;

  /** Tenant pool size. The system pool is always 3, the detached pool always 2. */
  @Transform(({ value }) => (value === undefined ? 10 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(100)
  DATABASE_POOL_SIZE: number = 10;

  @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters' })
  JWT_SECRET!: string;

  @Matches(DURATION, { message: 'JWT_ACCESS_TTL must be a duration like 15m' })
  JWT_ACCESS_TTL: string = '15m';

  @Matches(DURATION, { message: 'JWT_REFRESH_TTL must be a duration like 30d' })
  JWT_REFRESH_TTL: string = '30d';

  /** How often the outbox dispatcher runs (spec 05 §3). Not started under NODE_ENV=test. */
  @Transform(({ value }) => (value === undefined ? 1000 : Number(value)))
  @IsInt()
  @Min(100)
  OUTBOX_INTERVAL_MS: number = 1000;
}

/**
 * Passed to `ConfigModule.forRoot({ validate })`. Throws on the first invalid
 * value, which aborts bootstrap.
 */
export function validate(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    exposeDefaultValues: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    const details = errors
      .map((e) => `  - ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${details}`);
  }

  return validated;
}

/** Parses a duration accepted by the env schema (`15m`, `30d`, `500ms`) into milliseconds. */
export function durationToMs(value: string): number {
  const m = DURATION.exec(value);
  if (!m) throw new Error(`invalid duration: ${value}`);
  const n = Number(value.slice(0, -m[1].length));
  const unit = m[1];
  const factor = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit]!;
  return n * factor;
}
