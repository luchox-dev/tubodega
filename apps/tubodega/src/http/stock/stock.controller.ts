import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { BatchId, ProductId } from '@app/catalog';
import { GetOpenCustodies, GetStock, type NodeId } from '@app/inventory';
import type { RequestContext } from '@app/tenancy';
import { Ctx } from '../pipeline/params.decorators.js';
import { InvalidFilterError, parsePage } from '../shared/cursor-query.js';
import { ProblemDetailsView } from '../shared/shared.dto.js';
import { custodyView, pageView, stockPositionView } from '../shared/views.js';
import { OpenCustodyPageView, StockPageView } from './stock.dto.js';

const STOCK_PAGE = {
  // A balance has no meaningful order beyond its natural key, and offering one
  // would be offering a seq scan.
  sortable: ['nodeId'],
  defaultSort: 'nodeId',
  filters: ['productId', 'nodeId', 'batchId', 'under', 'custodialOnly', 'nonZeroOnly'],
} as const;

const CUSTODY_PAGE = {
  sortable: ['occurredAt'],
  defaultSort: '-occurredAt',
  filters: ['nodeId', 'overdueOnly'],
} as const;

const flag = (query: Record<string, unknown>, key: string): boolean | undefined => {
  const raw = query[key];
  if (raw === undefined) return undefined;
  if (raw !== 'true' && raw !== 'false') throw new InvalidFilterError(key, `"${key}" debe ser true o false`);
  return raw === 'true';
};

const id = (query: Record<string, unknown>, key: string): string | undefined => {
  const raw = query[key];
  if (raw === undefined) return undefined;
  if (typeof raw !== 'string' || raw === '') throw new InvalidFilterError(key, `"${key}" debe ser un id`);
  return raw;
};

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('stock')
export class StockController {
  constructor(
    private readonly stock: GetStock,
    private readonly custodies: GetOpenCustodies,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Qué hay y dónde',
    description:
      'custodialOnly deja fuera SOURCE y TERMINAL, cuyo saldo es un acumulado y no existencias; sin él se ve «cuánto he vendido», que también es una pregunta legítima. nonZeroOnly viene activado. under agrega el subárbol entero.',
  })
  @ApiOkResponse({ type: StockPageView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'invalid-filter' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  async list(@Ctx() ctx: RequestContext, @Query() query: Record<string, unknown>): Promise<StockPageView> {
    const page = parsePage(query, STOCK_PAGE);
    const custodialOnly = flag(query, 'custodialOnly');
    const nonZeroOnly = flag(query, 'nonZeroOnly');
    const found = await this.stock.execute(
      ctx,
      {
        ...(id(query, 'productId') !== undefined ? { productId: id(query, 'productId') as ProductId } : {}),
        ...(id(query, 'nodeId') !== undefined ? { nodeId: id(query, 'nodeId') as NodeId } : {}),
        ...(id(query, 'batchId') !== undefined ? { batchId: id(query, 'batchId') as BatchId } : {}),
        ...(id(query, 'under') !== undefined ? { under: id(query, 'under') as NodeId } : {}),
        ...(custodialOnly !== undefined ? { custodialOnly } : {}),
        ...(nonZeroOnly !== undefined ? { nonZeroOnly } : {}),
      },
      { limit: page.limit, ...(page.cursor !== undefined ? { cursor: page.cursor } : {}) },
    );
    return pageView(found, stockPositionView);
  }

  @Get('custodies')
  @ApiOperation({
    summary: 'Qué está prestado y no ha vuelto',
    description:
      'Por préstamo, no por saldo: cada check-out con pendiente mayor que cero es una fila, con su propio dueAt.',
  })
  @ApiOkResponse({ type: OpenCustodyPageView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'invalid-filter' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  async open(
    @Ctx() ctx: RequestContext,
    @Query() query: Record<string, unknown>,
  ): Promise<OpenCustodyPageView> {
    const page = parsePage(query, CUSTODY_PAGE);
    const overdueOnly = flag(query, 'overdueOnly');
    const found = await this.custodies.execute(
      ctx,
      {
        ...(id(query, 'nodeId') !== undefined ? { nodeId: id(query, 'nodeId') as NodeId } : {}),
        ...(overdueOnly !== undefined ? { overdueOnly } : {}),
      },
      { ...page, sort: page.sort as { field: 'occurredAt'; dir: 'asc' | 'desc' } },
    );
    return pageView(found, custodyView);
  }
}
