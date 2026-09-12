import {
  Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, Res,
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation,
  ApiResponse, ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import {
  CreateProduct, DeactivateProduct, GetProduct, ImportProducts, ListMedia, ListProducts,
  TrackingMode, UpdateProduct, type ProductId,
} from '@app/catalog';
import type { RequestContext } from '@app/tenancy';
import { Ctx } from '../pipeline/params.decorators.js';
import { InvalidFilterError, parsePage } from '../shared/cursor-query.js';
import { parseIfMatch } from '../shared/if-match.js';
import { ProblemDetailsView } from '../shared/shared.dto.js';
import { pageView, productView } from '../shared/views.js';
import { UuidParam } from '../shared/uuid-param.pipe.js';
import {
  CreateProductDto, ImportProductsDto, ImportResultView, ProductPageView, ProductView,
  UpdateProductDto,
} from './products.dto.js';

const PAGE_OPTIONS = {
  sortable: ['name', 'sku', 'createdAt'],
  defaultSort: 'name',
  filters: ['active', 'trackingMode', 'q'],
} as const;

type Sort = { field: 'name' | 'sku' | 'createdAt'; dir: 'asc' | 'desc' };

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(
    private readonly createProduct: CreateProduct,
    private readonly listProducts: ListProducts,
    private readonly getProduct: GetProduct,
    private readonly updateProduct: UpdateProduct,
    private readonly deactivateProduct: DeactivateProduct,
    private readonly importProducts: ImportProducts,
    private readonly listMedia: ListMedia,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Lista el catálogo',
    description: 'Filtros: active, trackingMode, q (sobre sku y name). Orden: name, sku, createdAt.',
  })
  @ApiOkResponse({ type: ProductPageView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'invalid-filter · invalid-cursor' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials · token-expired' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  async list(@Ctx() ctx: RequestContext, @Query() query: Record<string, unknown>): Promise<ProductPageView> {
    const page = parsePage(query, PAGE_OPTIONS);
    const found = await this.listProducts.execute(ctx, {
      ...page,
      sort: page.sort as Sort,
      ...parseFilters(query),
    });
    return pageView(found, (p) => productView(p));
  }

  @Post()
  @ApiOperation({ summary: 'Define un producto', description: 'Puede traer sus códigos de una vez.' })
  @ApiCreatedResponse({ type: ProductView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed · missing-idempotency-key' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'sku-taken · code-taken · idempotency-key-reuse' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'invalid-custom-field · validation-failed' })
  async create(
    @Ctx() ctx: RequestContext,
    @Body() dto: CreateProductDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ProductView> {
    const product = await this.createProduct.execute(ctx, dto);
    void reply.header('Location', `/v1/products/${product.id}`);
    return productView(product);
  }

  @Post('import')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Importa una hoja de cálculo',
    description:
      'Coincidencia por SKU, upsert fila a fila. Una fila con error no aborta el lote: se acumula en errors con su número de línea.',
  })
  @ApiOkResponse({ type: ImportResultView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed · missing-idempotency-key' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'idempotency-key-reuse' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'import-too-large' })
  async import(@Ctx() ctx: RequestContext, @Body() dto: ImportProductsDto): Promise<ImportResultView> {
    const result = await this.importProducts.execute(ctx, dto.rows);
    return { created: result.created, updated: result.updated, errors: [...result.errors] };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Un producto por id', description: 'Incluye sus fotos.' })
  @ApiOkResponse({ type: ProductView })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found · también para otra organización (I-6)' })
  async get(@Ctx() ctx: RequestContext, @Param('id', UuidParam) id: string): Promise<ProductView> {
    const product = await this.getProduct.execute(ctx, id as ProductId);
    return productView(product, await this.listMedia.execute(ctx, product.id));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Modifica un producto', description: 'Exige If-Match con la versión.' })
  @ApiOkResponse({ type: ProductView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'missing-if-match · validation-failed' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'stale-version · sku-taken' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'tracking-mode-locked · invalid-custom-field' })
  async patch(
    @Ctx() ctx: RequestContext,
    @Param('id', UuidParam) id: string,
    @Body() dto: UpdateProductDto,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<ProductView> {
    const product = await this.updateProduct.execute(ctx, {
      id: id as ProductId,
      ...dto,
      expectedVersion: parseIfMatch(ifMatch),
    });
    return productView(product);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Retira un producto del catálogo',
    description: 'No borra: los movimientos lo referencian. Falla si todavía hay existencias (C-9).',
  })
  @ApiNoContentResponse()
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'product-has-stock' })
  async remove(@Ctx() ctx: RequestContext, @Param('id', UuidParam) id: string): Promise<void> {
    await this.deactivateProduct.execute(ctx, id as ProductId);
  }
}

/** Query values arrive as strings; only the declared ones reach here. */
function parseFilters(query: Record<string, unknown>): {
  active?: boolean;
  trackingMode?: TrackingMode;
  q?: string;
} {
  const out: { active?: boolean; trackingMode?: TrackingMode; q?: string } = {};
  if (query.active !== undefined) {
    if (query.active !== 'true' && query.active !== 'false') {
      throw new InvalidFilterError('active', '"active" debe ser true o false');
    }
    out.active = query.active === 'true';
  }
  if (query.trackingMode !== undefined) {
    if (!Object.values(TrackingMode).includes(query.trackingMode as TrackingMode)) {
      throw new InvalidFilterError(
        'trackingMode',
        `"trackingMode" debe ser uno de ${Object.values(TrackingMode).join(', ')}`,
      );
    }
    out.trackingMode = query.trackingMode as TrackingMode;
  }
  if (query.q !== undefined) {
    if (typeof query.q !== 'string') throw new InvalidFilterError('q', '"q" debe ser texto');
    out.q = query.q;
  }
  return out;
}
