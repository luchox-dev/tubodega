import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsInt, Min } from 'class-validator';
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

/**
 * Los pasos viajan como JSON crudo y el borde no los mira: quien decide si una
 * plantilla es ejecutable es `parseSteps` del dominio, que ya lo hace para las
 * seis de fábrica. Un `@ValidateNested` aquí sería una segunda copia de esas
 * reglas, y las dos se separarían —y sus respuestas serían `validation-failed`
 * en vez de los `branching-not-supported` / `unknown-step-type` /
 * `invalid-template` que la spec 13 §12 promete—.
 */
export class CreateTemplateVersionDto {
  @ApiProperty({
    example: 2,
    description: 'Debe superar a la activa; si ya existe, 409 template-version-taken',
  })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiProperty({
    type: StepView,
    isArray: true,
    description: 'La plantilla entera, no un parche: se crea una versión nueva, no se edita la anterior (P-9)',
  })
  @IsArray()
  @ArrayMinSize(1)
  steps!: unknown[];
}
