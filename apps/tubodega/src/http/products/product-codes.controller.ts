import { Body, Controller, Delete, Get, HttpCode, Param, Post, Res } from '@nestjs/common';
import {
  ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation,
  ApiResponse, ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import {
  AddProductCode, ListCodes, RemoveProductCode, type ProductCodeId, type ProductId,
} from '@app/catalog';
import type { RequestContext } from '@app/tenancy';
import { Ctx } from '../pipeline/params.decorators.js';
import { ProblemDetailsView } from '../shared/shared.dto.js';
import { productCodeView } from '../shared/views.js';
import { UuidParam } from '../shared/uuid-param.pipe.js';
import { ProductCodeInputDto, ProductCodeView } from './products.dto.js';

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('products/:id/codes')
export class ProductCodesController {
  constructor(
    private readonly add: AddProductCode,
    private readonly list: ListCodes,
    private readonly remove: RemoveProductCode,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Los códigos con que se escanea un producto' })
  @ApiOkResponse({ type: ProductCodeView, isArray: true })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  async listCodes(
    @Ctx() ctx: RequestContext,
    @Param('id', UuidParam) id: string,
  ): Promise<ProductCodeView[]> {
    return (await this.list.execute(ctx, id as ProductId)).map(productCodeView);
  }

  @Post()
  @ApiOperation({
    summary: 'Añade un código',
    description: 'Único por organización: un escaneo nunca puede ser ambiguo (C-2).',
  })
  @ApiCreatedResponse({ type: ProductCodeView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed · missing-idempotency-key' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'code-taken · el detalle nombra el producto que ya lo usa' })
  async addCode(
    @Ctx() ctx: RequestContext,
    @Param('id', UuidParam) id: string,
    @Body() dto: ProductCodeInputDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ProductCodeView> {
    const code = await this.add.execute(ctx, { productId: id as ProductId, ...dto });
    void reply.header('Location', `/v1/products/${id}/codes/${code.id}`);
    return productCodeView(code);
  }

  @Delete(':codeId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Quita un código' })
  @ApiNoContentResponse()
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found · code-not-found' })
  async removeCode(
    @Ctx() ctx: RequestContext,
    @Param('id', UuidParam) id: string,
    @Param('codeId', UuidParam) codeId: string,
  ): Promise<void> {
    await this.remove.execute(ctx, id as ProductId, codeId as ProductCodeId);
  }
}
