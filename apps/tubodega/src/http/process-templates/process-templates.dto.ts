import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { STEP_TYPES, type StepType } from '@app/process';

export class TransitionView {
  @ApiPropertyOptional({
    example: 'cantidad',
    nullable: true,
    description: 'El paso siguiente; null cierra el proceso',
  })
  to!: string | null;
}

export class StepView {
  @ApiProperty({ example: 'cantidad', description: 'Único dentro de la plantilla; es como se completa el paso' })
  id!: string;

  @ApiProperty({ example: 'CAPTURE_QTY', enum: STEP_TYPES })
  type!: StepType;

  @ApiProperty({ example: true, description: 'Un paso opcional se omite completándolo con payload null' })
  required!: boolean;

  @ApiProperty({
    example: { role: 'TO', allowedKinds: ['INTERNAL'] },
    description: 'Lo interpreta el manejador del paso, y nadie más',
  })
  config!: Record<string, unknown>;

  @ApiProperty({
    type: TransitionView,
    isArray: true,
    description: 'Hoy exactamente una: los flujos con ramas están previstos y todavía no existen (P-8)',
  })
  transitions!: TransitionView[];
}

export class ProcessTemplateView {
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6' }) id!: string;
  @ApiProperty({ example: 'RECEPCION', description: 'El nombre de negocio del proceso' }) code!: string;
  @ApiProperty({ example: 1, description: 'Una instancia guarda la versión con la que empezó' }) version!: number;
  @ApiProperty({ example: true }) active!: boolean;
  @ApiProperty({ type: StepView, isArray: true }) steps!: StepView[];
}

/**
 * Sin sobre de paginación: son seis, y el día que sean por organización seguirán
 * siendo pocas. `data` y no una lista pelada, para que el cuerpo se parezca al
 * de las demás colecciones del contrato.
 */
export class ProcessTemplateListView {
  @ApiProperty({ type: ProcessTemplateView, isArray: true }) data!: ProcessTemplateView[];
}
