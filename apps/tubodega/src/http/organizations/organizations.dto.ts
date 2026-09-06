import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsString, Length, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { OrganizationView, UserView } from '../shared/shared.dto.js';

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

export class OrganizationCreatedView {
  @ApiProperty({ type: OrganizationView }) organization!: OrganizationView;
  @ApiProperty({ type: UserView }) owner!: UserView;
}
