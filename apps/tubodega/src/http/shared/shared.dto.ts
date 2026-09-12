// Response shapes shared by several resources. Documented with examples so
// the generated OpenAPI carries them (spec 03 §10).
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
  @ApiProperty({ example: 1, description: 'Se envía en If-Match para modificarlo' }) version!: number;
}

/** The cursor envelope of spec 03 §6, the same for every collection. */
export class PageView {
  @ApiPropertyOptional({ example: 'W3siYSI6MX1d', description: 'Opaco: se devuelve tal cual en `cursor`' })
  nextCursor?: string;
  @ApiProperty({ example: true }) hasMore!: boolean;
}

/** RFC 9457 body (spec 03 §5), declared as the error response of every endpoint. */
export class ProblemDetailsView {
  @ApiProperty({ example: 'https://tubodega.app/errors/slug-taken' }) type!: string;
  @ApiProperty({ example: 'Conflicto' }) title!: string;
  @ApiProperty({ example: 409 }) status!: number;
  @ApiProperty({ example: 'El slug "la-esquina" ya está en uso' }) detail!: string;
  @ApiProperty({ example: '/v1/organizations' }) instance!: string;
  @ApiProperty({ example: '018f3a2b-7c4d-7000-8000-a1b2c3d4e5f6' }) traceId!: string;
  @ApiPropertyOptional({ example: [{ pointer: '/slug', code: 'isLength' }], isArray: true }) errors?: unknown[];
}
