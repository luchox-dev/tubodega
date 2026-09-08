import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { UserView } from '../shared/shared.dto.js';

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

export class TokenPairView {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiJ9…' }) accessToken!: string;
  @ApiProperty({ example: 'k3JgQ…', description: 'Opaco; se rota en cada uso' }) refreshToken!: string;
  @ApiProperty({ example: 900, description: 'Segundos de validez del accessToken' }) expiresIn!: number;
  @ApiProperty({ type: UserView }) user!: UserView;
}

export class RefreshDto {
  @ApiProperty({ example: 'k3JgQ…' })
  @IsString()
  @MaxLength(512)
  refreshToken!: string;
}

/** Rotation returns a fresh pair; the user is already known to the caller. */
export class TokenRotationView {
  @ApiProperty({ example: 'eyJhbGciOiJIUzI1NiJ9…' }) accessToken!: string;
  @ApiProperty({ example: 'k3JgQ…', description: 'Nuevo; el anterior queda revocado' }) refreshToken!: string;
  @ApiProperty({ example: 900 }) expiresIn!: number;
}
