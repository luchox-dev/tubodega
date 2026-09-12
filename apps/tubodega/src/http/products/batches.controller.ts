import { Body, Controller, Get, Param, Post, Res } from '@nestjs/common';
import {
  ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { CreateBatch, ListBatches, type ProductId } from '@app/catalog';
import type { RequestContext } from '@app/tenancy';
import { Ctx } from '../pipeline/params.decorators.js';
import { ProblemDetailsView } from '../shared/shared.dto.js';
import { batchView } from '../shared/views.js';
import { UuidParam } from '../shared/uuid-param.pipe.js';
import { BatchView, CreateBatchDto } from './products.dto.js';

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('products/:id/batches')
export class BatchesController {
  constructor(
    private readonly create: CreateBatch,
    private readonly list: ListBatches,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Los lotes o series de un producto' })
  @ApiOkResponse({ type: BatchView, isArray: true })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  async listBatches(
    @Ctx() ctx: RequestContext,
    @Param('id', UuidParam) id: string,
  ): Promise<BatchView[]> {
    return (await this.list.execute(ctx, id as ProductId)).map(batchView);
  }

  @Post()
  @ApiOperation({
    summary: 'Identifica una remesa',
    description:
      'La única escritura de catálogo abierta a OPERATOR: un lote nuevo llega con la mercancía, y exigir un administrador detendría cada recepción en el muelle.',
  })
  @ApiCreatedResponse({ type: BatchView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed · missing-idempotency-key' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'serial-taken · lot-code-taken' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'batch-not-allowed · batch-required' })
  async createBatch(
    @Ctx() ctx: RequestContext,
    @Param('id', UuidParam) id: string,
    @Body() dto: CreateBatchDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BatchView> {
    const batch = await this.create.execute(ctx, {
      productId: id as ProductId,
      ...(dto.lotCode !== undefined ? { lotCode: dto.lotCode } : {}),
      ...(dto.serial !== undefined ? { serial: dto.serial } : {}),
      ...(dto.expiresAt !== undefined ? { expiresAt: new Date(dto.expiresAt) } : {}),
      ...(dto.customFields !== undefined ? { customFields: dto.customFields } : {}),
    });
    void reply.header('Location', `/v1/products/${id}/batches/${batch.id}`);
    return batchView(batch);
  }
}
