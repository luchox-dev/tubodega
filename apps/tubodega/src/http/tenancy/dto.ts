import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsOptional, IsString, Length, MaxLength, MinLength, ValidateNested } from 'class-validator';

export class OwnerDto {
  @ApiProperty({ example: 'marta@esquina.co' })
  @IsString()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'Marta' })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ example: 'correcthorse1', minLength: 10 })
  @IsString()
  @MinLength(10)
  @MaxLength(256)
  password!: string;
}

export class CreateOrganizationDto {
  @ApiProperty({ example: 'Distribuidora La Esquina' })
  @IsString()
  @Length(1, 120)
  name!: string;

  @ApiProperty({ example: 'la-esquina', description: 'minúsculas, dígitos y guiones, 3-64' })
  @IsString()
  @Length(3, 64)
  slug!: string;

  @ApiProperty({ type: OwnerDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => OwnerDto)
  owner!: OwnerDto;
}

export class LoginDto {
  @ApiProperty({ example: 'marta@esquina.co' })
  @IsString()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ example: 'correcthorse1' })
  @IsString()
  @MaxLength(256)
  password!: string;

  @ApiPropertyOptional({ example: 'la-esquina', description: 'Obligatorio si el correo existe en varias organizaciones' })
  @IsOptional()
  @IsString()
  @Length(3, 64)
  slug?: string;
}

// ── Response shapes (documented; built by the controllers) ─────────────────

export class OrganizationView {
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6' }) id!: string;
  @ApiProperty({ example: 'Distribuidora La Esquina' }) name!: string;
  @ApiProperty({ example: 'la-esquina' }) slug!: string;
}

export class UserView {
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f7' }) id!: string;
  @ApiProperty({ example: 'marta@esquina.co' }) email!: string;
  @ApiProperty({ example: 'Marta' }) name!: string;
  @ApiProperty({ example: ['OWNER'], isArray: true, enum: ['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'] }) roles!: string[];
  @ApiProperty({ example: true }) active!: boolean;
}

export class OrganizationCreatedView {
  @ApiProperty({ type: OrganizationView }) organization!: OrganizationView;
  @ApiProperty({ type: UserView }) owner!: UserView;
}

export class TokenPairView {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiJ9…' }) accessToken!: string;
  @ApiProperty({ example: 'k3JgQ…', description: 'Opaco; se rota en cada uso' }) refreshToken!: string;
  @ApiProperty({ example: 900, description: 'Segundos de validez del accessToken' }) expiresIn!: number;
  @ApiProperty({ type: UserView }) user!: UserView;
}

export class MeView {
  @ApiProperty({ type: UserView }) user!: UserView;
  @ApiProperty({ type: OrganizationView }) organization!: OrganizationView;
}

export class ProblemDetailsView {
  @ApiProperty({ example: 'https://tubodega.app/errors/slug-taken' }) type!: string;
  @ApiProperty({ example: 'Conflicto' }) title!: string;
  @ApiProperty({ example: 409 }) status!: number;
  @ApiProperty({ example: 'El slug "la-esquina" ya está en uso' }) detail!: string;
  @ApiProperty({ example: '/v1/organizations' }) instance!: string;
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6' }) traceId!: string;
  @ApiPropertyOptional({ example: [{ pointer: '/slug', code: 'isLength' }], isArray: true }) errors?: unknown[];
}
