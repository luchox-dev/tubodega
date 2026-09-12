import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsDateString, IsOptional, IsString,
  IsUUID, Length, Matches, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MAX_BATCH_MOVEMENTS } from '@app/inventory';
import { PageView } from '../shared/shared.dto.js';

/**
 * Up to 15 integer digits and 3 decimals, **as a string**. Never `@IsNumber()`:
 * a JSON number has already been through a double before we see it, and 0.1
 * stops being 0.1 long before it reaches the integer of thousandths the domain
 * keeps precisely to avoid that (spec 12 §2).
 */
export const QUANTITY_RE = /^\d{1,15}(\.\d{1,3})?$/;
const QUANTITY = {
  example: '12.500',
  description: 'Decimal como cadena, hasta 3 decimales. Estrictamente positivo (I-2)',
};

export class CreateMovementDto {
  @ApiPropertyOptional({
    example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6',
    description: 'UUIDv7 del cliente. Si se repite con otra Idempotency-Key, 409 movement-id-taken',
  })
  @IsOptional()
  @IsUUID()
  id?: string;

  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f0' })
  @IsUUID()
  productId!: string;

  @ApiPropertyOptional({
    example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f1',
    description: 'Obligatorio si el producto es LOT o SERIAL; prohibido si es QUANTITY (I-8)',
  })
  @IsOptional()
  @IsUUID()
  batchId?: string;

  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f2', description: 'De dónde sale' })
  @IsUUID()
  fromNodeId!: string;

  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f3', description: 'A dónde entra' })
  @IsUUID()
  toNodeId!: string;

  @ApiProperty(QUANTITY)
  @Matches(QUANTITY_RE, { message: 'quantity debe ser un decimal de hasta 3 cifras, como cadena' })
  quantity!: string;

  @ApiProperty({ example: '2026-09-12T14:32:00.000Z', description: 'Cuándo pasó. Hasta 5 minutos por delante del reloj (I-14)' })
  @IsDateString()
  occurredAt!: string;

  @ApiPropertyOptional({
    example: 'se mojó en el traslado',
    description: 'Obligatorio contra adjustment-in, adjustment-out y shrinkage',
  })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  reason?: string;

  @ApiPropertyOptional({ example: '2026-09-19T12:00:00.000Z', description: 'Solo hacia un nodo CUSTODY (I-11)' })
  @IsOptional()
  @IsDateString()
  dueAt?: string;

  @ApiPropertyOptional({
    example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f4',
    description: 'El préstamo que esta devolución salda. Obligatorio si el origen es CUSTODY (I-17)',
  })
  @IsOptional()
  @IsUUID()
  settlesId?: string;

  @ApiPropertyOptional({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f5' })
  @IsOptional()
  @IsUUID()
  processInstanceId?: string;
}

export class RecordMovementBatchDto {
  @ApiProperty({
    type: CreateMovementDto,
    isArray: true,
    description: `Todo o nada, en una transacción. Hasta ${MAX_BATCH_MOVEMENTS}`,
  })
  @IsArray()
  @ArrayMinSize(1)
  // One over the limit, so the 501st movement is `batch-too-large` from the use
  // case — a business answer with its own `type` — and not a bare 400.
  @ArrayMaxSize(MAX_BATCH_MOVEMENTS + 1)
  @ValidateNested({ each: true })
  @Type(() => CreateMovementDto)
  movements!: CreateMovementDto[];
}

export class ReverseMovementDto {
  @ApiProperty({
    example: 'eran 10 unidades, no 100',
    description: 'Obligatorio: una corrección sin explicación no sirve a quien audite después',
  })
  @IsString()
  @Length(1, 500)
  reason!: string;
}

// ── Responses

export class MovementView {
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6' }) id!: string;
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f0' }) productId!: string;
  @ApiPropertyOptional({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f1' }) batchId?: string;
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f2' }) fromNodeId!: string;
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f3' }) toNodeId!: string;
  @ApiProperty({ example: '12.500' }) quantity!: string;
  @ApiProperty({ example: '2026-09-12T14:32:00.000Z', description: 'Cuándo pasó, según quien lo registró' })
  occurredAt!: string;
  @ApiProperty({ example: '2026-09-12T14:33:10.000Z', description: 'Cuándo lo recibió el servidor. Los dos relojes se ven, y eso es lo que hace auditable el histórico' })
  recordedAt!: string;
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f7' }) actorId!: string;
  @ApiPropertyOptional({ example: 'se mojó en el traslado' }) reason?: string;
  @ApiPropertyOptional({ example: '2026-09-19T12:00:00.000Z' }) dueAt?: string;
  @ApiPropertyOptional({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f8', description: 'El movimiento que este compensa' })
  reversesId?: string;
  @ApiPropertyOptional({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f4', description: 'El préstamo que esta devolución salda' })
  settlesId?: string;
  @ApiPropertyOptional({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f5' }) processInstanceId?: string;
  // No `version`: a movement is never edited, so there is no If-Match to ask for.
}

export class StockPositionView {
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f2', description: 'Vacío en una suma por subárbol' })
  nodeId!: string;
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f0' }) productId!: string;
  @ApiPropertyOptional({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f1' }) batchId?: string;
  @ApiProperty({ example: 'INTERNAL', enum: ['INTERNAL', 'CUSTODY', 'TERMINAL', 'SOURCE'] }) nodeKind!: string;
  @ApiProperty({ example: '87.500' }) quantity!: string;
}

export class RecordedMovementView {
  @ApiProperty({ type: MovementView }) movement!: MovementView;
  @ApiProperty({ type: StockPositionView, isArray: true, description: 'Los dos extremos, como quedaron' })
  balances!: StockPositionView[];
}

export class RecordedBatchView {
  @ApiProperty({ type: MovementView, isArray: true }) movements!: MovementView[];
  @ApiProperty({ type: StockPositionView, isArray: true }) balances!: StockPositionView[];
}

export class MovementPageView {
  @ApiProperty({ type: MovementView, isArray: true }) data!: MovementView[];
  @ApiProperty({ type: PageView }) page!: PageView;
}
