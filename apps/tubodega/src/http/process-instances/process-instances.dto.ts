import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { ProcessState } from '@app/process';
import { PageView } from '../shared/shared.dto.js';
import { StepView } from '../process-templates/process-templates.dto.js';

export class StartProcessDto {
  @ApiProperty({ example: 'RECEPCION', description: 'El código de negocio del proceso a ejecutar' })
  @IsString()
  @Length(1, 64)
  templateCode!: string;

  @ApiPropertyOptional({
    example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6',
    description: 'UUIDv7 del cliente. Si se repite con otra Idempotency-Key, 409 process-instance-id-taken',
  })
  @IsOptional()
  @IsUUID()
  id?: string;
}

/**
 * El payload del paso, tal cual: cada manejador sabe leer el suyo, y el borde
 * no. Validarlo aquí sería reimplementar los ocho manejadores en DTOs y que las
 * dos copias se separaran (spec 13 §4.2).
 *
 * `null` es omitir el paso, y es la única forma de avanzar sin datos: el cliente
 * genérico tiene un solo gesto —completar el paso actual— y no necesita un
 * endpoint de «saltar».
 */
export class CompleteStepDto {
  @ApiPropertyOptional({
    example: { quantity: '24' },
    nullable: true,
    description: 'Lo que pide el paso. null omite el paso, si el paso lo admite',
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown> | null;
}

// ── Responses

export class ProcessInstanceView {
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6' }) id!: string;
  @ApiProperty({ example: 'RECEPCION' }) templateCode!: string;
  @ApiProperty({ example: 1, description: 'La versión con la que nació, y con la que termina (P-1)' })
  templateVersion!: number;
  @ApiProperty({ example: 'OPEN', enum: Object.values(ProcessState) }) state!: ProcessState;
  @ApiPropertyOptional({
    example: 'cantidad',
    description: 'El paso que espera. En una cancelada es dónde se abandonó',
  })
  currentStepId?: string;
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f7', description: 'Quién la abrió' })
  actorId!: string;
  // Sin `version`: el bloqueo optimista de esta tabla es interno y no contrato,
  // y ningún endpoint pide If-Match (spec 13 §9).
}

export class StepCompletionView {
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f8' }) id!: string;
  @ApiProperty({ example: 'cantidad' }) stepId!: string;
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f7' }) actorId!: string;
  @ApiProperty({
    nullable: true,
    example: { quantity: '24' },
    description: 'Lo que el motor entendió, no solo lo que llegó. null si el paso se omitió',
  })
  payload!: Record<string, unknown> | null;
  @ApiProperty({ example: '2026-09-19T14:32:00.000Z' }) completedAt!: string;
}

export class StartedProcessView {
  @ApiProperty({ type: ProcessInstanceView }) instance!: ProcessInstanceView;
  @ApiProperty({ type: StepView, description: 'La definición del primer paso, no su id' })
  nextStep!: StepView;
}

export class CompletedStepView {
  @ApiProperty({ type: ProcessInstanceView }) instance!: ProcessInstanceView;
  @ApiPropertyOptional({ type: StepView, description: 'Lo siguiente que pedir. Ausente si el proceso terminó' })
  nextStep?: StepView;
  @ApiPropertyOptional({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description: 'Los asientos que produjo el proceso. Solo al terminar (P-6)',
  })
  movements?: unknown[];
}

export class ProcessInstanceDetailView {
  @ApiProperty({ type: ProcessInstanceView }) instance!: ProcessInstanceView;
  @ApiProperty({ type: StepCompletionView, isArray: true, description: 'En el orden en que ocurrieron' })
  completions!: StepCompletionView[];
  @ApiPropertyOptional({
    type: StepView,
    description: 'La definición del paso que espera, mientras siga abierta: así se retoma sin consultar la plantilla',
  })
  currentStep?: StepView;
}

export class ProcessInstancePageView {
  @ApiProperty({ type: ProcessInstanceView, isArray: true }) data!: ProcessInstanceView[];
  @ApiProperty({ type: PageView }) page!: PageView;
}
