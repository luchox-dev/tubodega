import { Transform, plainToInstance } from 'class-transformer';
import { IsEnum, IsInt, Max, Min, validateSync } from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * The validated shape of the environment. Anything the app reads through
 * `ConfigService` should be declared here so a bad value fails at boot rather
 * than at the first request that happens to touch it.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Transform(({ value }) => (value === undefined ? 3000 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;
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
