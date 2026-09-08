import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, IsArray, IsEnum, IsString, Length, MaxLength, MinLength } from 'class-validator';
import { Role } from '@app/tenancy';
import { PageView, UserView } from '../shared/shared.dto.js';

const ROLES = Object.values(Role);

export class CreateUserDto {
  @ApiProperty({ example: 'juan@esquina.co' })
  @IsString()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Juan' })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ example: 'correcthorse1', minLength: 10 })
  @IsString()
  @MinLength(10)
  @MaxLength(256)
  password!: string;

  @ApiProperty({ example: ['OPERATOR'], isArray: true, enum: ROLES })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(Role, { each: true })
  roles!: Role[];
}

/**
 * Roles and nothing else. Changing the email or reactivating a user is not in
 * spec 10 §4, and `whitelist: true` drops whatever else arrives, in silence.
 */
export class UpdateUserRolesDto {
  @ApiProperty({ example: ['ADMIN'], isArray: true, enum: ROLES })
  @IsArray()
  @ArrayNotEmpty()
  @IsEnum(Role, { each: true })
  roles!: Role[];
}

export class ChangePasswordDto {
  @ApiProperty({ example: 'correcthorse1' })
  @IsString()
  @MaxLength(256)
  current!: string;

  @ApiProperty({ example: 'unmejorsecreto9', minLength: 10 })
  @IsString()
  @MinLength(10)
  @MaxLength(256)
  next!: string;
}

export class UserPageView {
  @ApiProperty({ type: UserView, isArray: true }) data!: UserView[];
  @ApiProperty({ type: PageView }) page!: PageView;
}

/** Query parameters `GET /v1/users` accepts. Anything else is 400 invalid-filter. */
export class ListUsersQueryDto {
  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 200 }) limit?: number;
  @ApiPropertyOptional({ example: 'W3siYSI6MX1d', description: 'Cursor opaco; no se interpreta' }) cursor?: string;
  @ApiPropertyOptional({ example: '-name', enum: ['name', '-name', 'email', '-email'] }) sort?: string;
  @ApiPropertyOptional({ example: true }) active?: boolean;
  @ApiPropertyOptional({ example: 'OPERATOR', enum: ROLES }) role?: Role;
}
