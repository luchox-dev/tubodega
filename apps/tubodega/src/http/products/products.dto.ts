import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayNotEmpty, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsObject,
  IsOptional, IsString, Length, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { CodeKind, MAX_IMPORT_ROWS, TrackingMode, UnitOfMeasure } from '@app/catalog';
import { PageView } from '../shared/shared.dto.js';

const MODES = Object.values(TrackingMode);
const KINDS = Object.values(CodeKind);
const UOMS = Object.values(UnitOfMeasure);

export class ProductCodeInputDto {
  @ApiProperty({ example: '7501234567890' })
  @IsString()
  @Length(1, 128)
  value!: string;

  @ApiProperty({ example: 'EAN', enum: KINDS })
  @IsEnum(CodeKind)
  kind!: CodeKind;
}

export class CreateProductDto {
  @ApiProperty({ example: 'TOR-M8', description: 'Único por organización (C-1); se normaliza a mayúsculas' })
  @IsString()
  @Length(1, 64)
  sku!: string;

  @ApiProperty({ example: 'Tornillo M8 galvanizado' })
  @IsString()
  @Length(1, 500)
  name!: string;

  @ApiPropertyOptional({ example: 'Rosca fina, caja de 100' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ example: 'QUANTITY', enum: MODES, description: 'No cambia si el producto ya tiene movimientos (C-8)' })
  @IsEnum(TrackingMode)
  trackingMode!: TrackingMode;

  @ApiProperty({ example: 'UNIT', enum: UOMS })
  @IsString()
  @MaxLength(16)
  uom!: string;

  @ApiPropertyOptional({ type: ProductCodeInputDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductCodeInputDto)
  codes?: ProductCodeInputDto[];

  @ApiPropertyOptional({ example: { proveedor: 'Ferretería Mundial' } })
  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;
}

export class UpdateProductDto {
  @ApiPropertyOptional({ example: 'Tornillo M8 inoxidable' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  name?: string;

  @ApiPropertyOptional({ example: 'Rosca fina', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ example: 'LOT', enum: MODES })
  @IsOptional()
  @IsEnum(TrackingMode)
  trackingMode?: TrackingMode;

  @ApiPropertyOptional({ example: 'KG', enum: UOMS })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  uom?: string;

  @ApiPropertyOptional({ example: { proveedor: 'Ferretería Mundial' } })
  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;
}

export class CreateBatchDto {
  @ApiPropertyOptional({ example: 'L-2026-09', description: 'Obligatorio si el producto se lleva por lote (C-3)' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  lotCode?: string;

  @ApiPropertyOptional({ example: 'BSH-001', description: 'Obligatorio si se lleva por número de serie (C-3)' })
  @IsOptional()
  @IsString()
  @Length(1, 128)
  serial?: string;

  @ApiPropertyOptional({ example: '2026-10-01T00:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({ example: { temperatura: 4 } })
  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;
}

export class ProductRowDto {
  @ApiProperty({ example: 'TOR-M8' })
  @IsString()
  @MaxLength(64)
  sku!: string;

  @ApiPropertyOptional({ example: 'Tornillo M8' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  name?: string;

  @ApiPropertyOptional({ example: 'Rosca fina' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ example: 'QUANTITY', enum: MODES })
  @IsOptional()
  @IsEnum(TrackingMode)
  trackingMode?: TrackingMode;

  @ApiPropertyOptional({ example: 'UNIT', enum: UOMS })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  uom?: string;

  @ApiPropertyOptional({ example: ['7501234567890'], isArray: true, type: String })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  codes?: string[];

  @ApiPropertyOptional({ example: { proveedor: 'Ferretería Mundial' } })
  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;
}

export class ImportProductsDto {
  /**
   * El tope de D-11 lo impone `ImportProducts`, no un `@ArrayMaxSize` aquí. Con
   * el validador en el borde la respuesta era `400 validation-failed`, y mil una
   * filas no son una petición que no se entienda: se entiende perfectamente y la
   * rechaza una regla de negocio. El contrato es firme en eso ([03 §5]), así que
   * el límite se comprueba donde vive la regla y sale como `422 import-too-large`.
   */
  @ApiProperty({ type: ProductRowDto, isArray: true, description: `Máximo ${MAX_IMPORT_ROWS} filas (D-11)` })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductRowDto)
  rows!: ProductRowDto[];
}

/** Claiming keys from the waiting room; the direct upload arrives as multipart. */
export class AttachMediaDto {
  @ApiProperty({ example: ['018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6/9f2c-ab12.png'], isArray: true, type: String })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  storageKeys!: string[];
}

// ── Responses

export class MediaView {
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f8' }) id!: string;
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6/9f2c-ab12.png' }) storageKey!: string;
  @ApiProperty({ example: 'image/png' }) contentType!: string;
  @ApiProperty({ example: 20480 }) byteSize!: number;
  @ApiProperty({ example: 0 }) position!: number;
}

export class ProductView {
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6' }) id!: string;
  @ApiProperty({ example: 'TOR-M8' }) sku!: string;
  @ApiProperty({ example: 'Tornillo M8 galvanizado' }) name!: string;
  @ApiPropertyOptional({ example: 'Rosca fina, caja de 100' }) description?: string;
  @ApiProperty({ example: 'QUANTITY', enum: MODES }) trackingMode!: string;
  @ApiProperty({ example: 'UNIT', enum: UOMS }) uom!: string;
  @ApiProperty({ example: true }) active!: boolean;
  @ApiProperty({ example: { proveedor: 'Ferretería Mundial' } }) customFields!: Record<string, unknown>;
  @ApiProperty({ example: 1, description: 'Se envía en If-Match para modificarlo' }) version!: number;
  @ApiPropertyOptional({ type: MediaView, isArray: true }) media?: MediaView[];
}

export class ProductCodeView {
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f7' }) id!: string;
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6' }) productId!: string;
  @ApiProperty({ example: '7501234567890' }) value!: string;
  @ApiProperty({ example: 'EAN', enum: KINDS }) kind!: string;
}

export class BatchView {
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f9' }) id!: string;
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6' }) productId!: string;
  @ApiPropertyOptional({ example: 'L-2026-09' }) lotCode?: string;
  @ApiPropertyOptional({ example: 'BSH-001' }) serial?: string;
  @ApiPropertyOptional({ example: '2026-10-01T00:00:00.000Z' }) expiresAt?: string;
  @ApiProperty({ example: { temperatura: 4 } }) customFields!: Record<string, unknown>;
}

export class ProductPageView {
  @ApiProperty({ type: ProductView, isArray: true }) data!: ProductView[];
  @ApiProperty({ type: PageView }) page!: PageView;
}

export class RowErrorView {
  @ApiProperty({ example: 347, description: '1-indexado, como lo ve el usuario en la hoja' }) line!: number;
  @ApiPropertyOptional({ example: 'TOR-M8' }) sku?: string;
  @ApiProperty({ example: 'invalid-custom-field' }) type!: string;
  @ApiProperty({ example: 'El campo familia no es válido' }) detail!: string;
}

export class ImportResultView {
  @ApiProperty({ example: 498 }) created!: number;
  @ApiProperty({ example: 0 }) updated!: number;
  @ApiProperty({ type: RowErrorView, isArray: true }) errors!: RowErrorView[];
}

export class ResolvedCodeView {
  @ApiProperty({ type: ProductView }) product!: ProductView;
  @ApiPropertyOptional({ type: BatchView }) batch?: BatchView;
}

export class UploadView {
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6/9f2c-ab12.png' }) storageKey!: string;
  @ApiProperty({ example: '2026-09-13T12:00:00.000Z', description: 'Sin reclamar, se purga entonces' }) expiresAt!: string;
}

/** Documents the query of GET /v1/products; anything else is 400 invalid-filter. */
export class ListProductsQueryDto {
  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 200 }) limit?: number;
  @ApiPropertyOptional({ example: 'W3siYSI6MX1d', description: 'Cursor opaco; no se interpreta' }) cursor?: string;
  @ApiPropertyOptional({ example: '-name', enum: ['name', '-name', 'sku', '-sku', 'createdAt', '-createdAt'] }) sort?: string;
  @ApiPropertyOptional({ example: true }) active?: boolean;
  @ApiPropertyOptional({ example: 'LOT', enum: MODES }) trackingMode?: TrackingMode;
  @ApiPropertyOptional({ example: 'tornillo', description: 'Coincide sobre sku y name' }) q?: string;
}
