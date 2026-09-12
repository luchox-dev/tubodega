import { Controller, Delete, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth, ApiBody, ApiConsumes, ApiCreatedResponse, ApiNoContentResponse, ApiOperation,
  ApiResponse, ApiTags,
} from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import {
  AttachMedia, RemoveMedia, UnsupportedMediaTypeError,
  type MediaId, type ProductId, type StorageKey,
} from '@app/catalog';
import type { RequestContext } from '@app/tenancy';
import { Ctx } from '../pipeline/params.decorators.js';
import { ProblemDetailsView } from '../shared/shared.dto.js';
import { mediaView } from '../shared/views.js';
import { UuidParam } from '../shared/uuid-param.pipe.js';
import { isMultipart, readFiles } from '../uploads/multipart.js';
import { AttachMediaDto, MediaView } from './products.dto.js';

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('products/:id/media')
export class ProductMediaController {
  constructor(
    private readonly attach: AttachMedia,
    private readonly remove: RemoveMedia,
  ) {}

  @Post()
  @ApiConsumes('application/json', 'multipart/form-data')
  @ApiBody({ type: AttachMediaDto })
  @ApiOperation({
    summary: 'Adjunta fotos a un producto',
    description:
      'Dos formas: reclamar claves de la zona de espera con { storageKeys } — basta RECORD_MOVEMENT — o subir multipart directo, que sí es un cambio de catálogo (D-14).',
  })
  @ApiCreatedResponse({ type: MediaView, isArray: true })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed · missing-idempotency-key' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  @ApiResponse({ status: 413, type: ProblemDetailsView, description: 'media-too-large' })
  @ApiResponse({ status: 415, type: ProblemDetailsView, description: 'unsupported-media-type' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'upload-not-found' })
  async attachMedia(
    @Ctx() ctx: RequestContext,
    @Param('id', UuidParam) id: string,
    @Req() req: FastifyRequest,
  ): Promise<MediaView[]> {
    const productId = id as ProductId;

    if (isMultipart(req)) {
      const files = await readFiles(req);
      if (files.length === 0) throw new UnsupportedMediaTypeError('ninguno');
      return (await this.attach.execute(ctx, { productId, files })).map(mediaView);
    }

    // The global pipe does not see this body: the route also accepts multipart,
    // so the DTO is validated here, by hand, on the JSON branch only.
    const body = req.body as { storageKeys?: unknown } | undefined;
    const keys = Array.isArray(body?.storageKeys) ? body.storageKeys : [];
    if (keys.length === 0 || keys.some((k) => typeof k !== 'string')) {
      throw new UnsupportedMediaTypeError('ninguno');
    }
    const attached = await this.attach.execute(ctx, {
      productId,
      storageKeys: keys as StorageKey[],
    });
    return attached.map(mediaView);
  }

  @Delete(':mediaId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Quita una foto', description: 'Borra la fila y después el archivo.' })
  @ApiNoContentResponse()
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  async removeMedia(
    @Ctx() ctx: RequestContext,
    @Param('id', UuidParam) id: string,
    @Param('mediaId', UuidParam) mediaId: string,
  ): Promise<void> {
    await this.remove.execute(ctx, id as ProductId, mediaId as MediaId);
  }
}
