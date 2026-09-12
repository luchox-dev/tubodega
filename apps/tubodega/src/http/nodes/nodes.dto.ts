import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmpty, IsEnum, IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { NODE_KINDS, NodeKind } from '@app/inventory';
import { PageView } from '../shared/shared.dto.js';

export class CreateNodeDto {
  @ApiProperty({
    example: 'INTERNAL',
    enum: NODE_KINDS,
    description: 'Solo INTERNAL anida; SOURCE y TERMINAL son la frontera del sistema',
  })
  @IsEnum(NodeKind)
  kind!: NodeKind;

  @ApiProperty({ example: 'B2', description: 'Único por organización; es el segmento del path, así que no lleva barras' })
  @IsString()
  @Length(1, 64)
  code!: string;

  @ApiProperty({ example: 'Bin 2' })
  @IsString()
  @Length(1, 500)
  name!: string;

  @ApiPropertyOptional({
    example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f0',
    description: 'El padre tiene que ser INTERNAL, y el hijo también (I-10)',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;

  @ApiPropertyOptional({ example: { responsable: 'Juan' } })
  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;
}

export class UpdateNodeDto {
  @ApiPropertyOptional({ example: 'Bin 2 · refrigerado' })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  name?: string;

  @ApiPropertyOptional({ example: { responsable: 'Juan' } })
  @IsOptional()
  @IsObject()
  customFields?: Record<string, unknown>;

  // The three immutable fields, declared so the pipe *rejects* them instead of
  // dropping them: `whitelist: true` only strips properties with no validation
  // metadata, so one carrying a decorator survives the strip and is validated,
  // and @IsEmpty fails for any value that is present. Without this a client
  // would send `kind` and get a 200 that changed nothing (decision D-24).
  //
  // No @ApiProperty on purpose: they are not accepted input, so they must not
  // appear in the schema — and there is no swagger CLI plugin in nest-cli.json,
  // so leaving the decorator off is enough to keep them out.

  @IsEmpty({ message: 'El tipo de un nodo no se cambia: está desnormalizado en el histórico de movimientos' })
  kind?: never;

  @IsEmpty({ message: 'El código de un nodo no se cambia: es la pieza con la que se construye el path' })
  code?: never;

  @IsEmpty({ message: 'El padre de un nodo se cambia con POST /v1/nodes/{id}/move' })
  parentId?: never;
}

export class MoveNodeDto {
  @ApiPropertyOptional({
    example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f0',
    description: 'Ausente mueve el nodo a la raíz. El destino no puede estar dentro del nodo que se mueve',
  })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

// ── Responses

export class NodeView {
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6' }) id!: string;
  @ApiProperty({ example: 'INTERNAL', enum: NODE_KINDS }) kind!: NodeKind;
  @ApiProperty({ example: 'B2' }) code!: string;
  @ApiProperty({ example: 'Bin 2' }) name!: string;
  @ApiPropertyOptional({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f0' }) parentId?: string;
  @ApiProperty({ example: 'BOD-A/Z1/E3/B2', description: 'La cadena de códigos, materializada' }) path!: string;
  @ApiProperty({ example: true }) active!: boolean;
  @ApiProperty({ example: { responsable: 'Juan' } }) customFields!: Record<string, unknown>;
  @ApiProperty({ example: 1, description: 'Se envía en If-Match para modificarlo' }) version!: number;
}

export class NodePageView {
  @ApiProperty({ type: NodeView, isArray: true }) data!: NodeView[];
  @ApiProperty({ type: PageView }) page!: PageView;
}

/**
 * Decision D-11: nested, not a flat list with parentId — the tree is the
 * structure, and a flat list would make every client re-derive it. Recursive,
 * so the lazy resolver is the sanctioned way to declare it.
 */
export class NodeTreeView {
  @ApiProperty({ type: () => NodeView }) node!: NodeView;
  @ApiProperty({ type: () => [NodeTreeView], description: 'Vacío en las hojas' }) children!: NodeTreeView[];
}
