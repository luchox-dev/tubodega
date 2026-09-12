import { Controller, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiOperation, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { StageUpload, UnsupportedMediaTypeError } from '@app/catalog';
import type { RequestContext } from '@app/tenancy';
import { Ctx } from '../pipeline/params.decorators.js';
import { UploadView } from '../products/products.dto.js';
import { ProblemDetailsView } from '../shared/shared.dto.js';
import { readFiles } from './multipart.js';

/**
 * The waiting room. A process captures photos before knowing whether it will
 * be confirmed, and the operator taking them does not hold MANAGE_CATALOG
 * (decision D-14). The photo belongs to no product yet.
 */
@ApiTags('catalog')
@ApiBearerAuth()
@Controller('uploads')
export class UploadsController {
  constructor(private readonly stage: StageUpload) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    description: 'Una imagen jpeg, png o webp, máximo 10 MB',
    schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
  })
  @ApiOperation({ summary: 'Sube una foto a la zona de espera', description: 'Sin reclamar, se purga a las 24 horas.' })
  @ApiCreatedResponse({ type: UploadView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed · missing-idempotency-key' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 413, type: ProblemDetailsView, description: 'media-too-large' })
  @ApiResponse({ status: 415, type: ProblemDetailsView, description: 'unsupported-media-type' })
  async upload(@Ctx() ctx: RequestContext, @Req() req: FastifyRequest): Promise<UploadView> {
    const [file] = await readFiles(req, 1);
    if (!file) throw new UnsupportedMediaTypeError('ninguno');
    const staged = await this.stage.execute(ctx, file);
    return { storageKey: staged.storageKey, expiresAt: staged.expiresAt.toISOString() };
  }
}
