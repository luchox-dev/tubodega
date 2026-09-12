import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty, IsArray, IsBoolean, IsEnum, IsInt, IsOptional, IsString, Length, Min,
} from 'class-validator';
import { CustomEntity, CustomType } from '@app/catalog';

const ENTITIES = Object.values(CustomEntity);
const TYPES = Object.values(CustomType);

export class DefineCustomFieldDto {
  @ApiProperty({ example: 'PRODUCT', enum: ENTITIES })
  @IsEnum(CustomEntity)
  entity!: CustomEntity;

  @ApiProperty({ example: 'proveedor', description: 'snake_case; inmutable una vez creada' })
  @IsString()
  @Length(1, 64)
  key!: string;

  @ApiProperty({ example: 'Proveedor' })
  @IsString()
  @Length(1, 200)
  label!: string;

  @ApiProperty({ example: 'TEXT', enum: TYPES })
  @IsEnum(CustomType)
  type!: CustomType;

  @ApiPropertyOptional({ example: ['ferretería', 'aseo'], isArray: true, type: String, description: 'Obligatorio para SELECT' })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  options?: string[];

  @ApiPropertyOptional({ example: false, description: 'Solo si ninguna entidad queda sin valor (C-10)' })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ example: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

/** `key` y `entity` no se cambian: el valor ya guardado quedaría huérfano. */
export class UpdateCustomFieldDto {
  @ApiPropertyOptional({ example: 'Proveedor principal' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  label?: string;

  @ApiPropertyOptional({ example: 'NUMBER', enum: TYPES, description: 'Solo si ninguna entidad tiene valor (D-10)' })
  @IsOptional()
  @IsEnum(CustomType)
  type?: CustomType;

  @ApiPropertyOptional({ example: ['ferretería', 'aseo', 'lácteos'], isArray: true, type: String })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  options?: string[];

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  position?: number;
}

export class CustomFieldView {
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5fa' }) id!: string;
  @ApiProperty({ example: 'PRODUCT', enum: ENTITIES }) entity!: string;
  @ApiProperty({ example: 'proveedor' }) key!: string;
  @ApiProperty({ example: 'Proveedor' }) label!: string;
  @ApiProperty({ example: 'TEXT', enum: TYPES }) type!: string;
  @ApiPropertyOptional({ example: ['ferretería', 'aseo'], isArray: true, type: String }) options?: string[];
  @ApiProperty({ example: false }) required!: boolean;
  @ApiProperty({ example: 0 }) position!: number;
  @ApiProperty({ example: 1, description: 'Se envía en If-Match para modificarla' }) version!: number;
}

export class CustomFieldListView {
  @ApiProperty({ type: CustomFieldView, isArray: true }) data!: CustomFieldView[];
}
