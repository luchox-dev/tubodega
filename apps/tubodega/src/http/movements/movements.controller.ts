import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import {
  ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { UserId } from '@app/common';
import type { BatchId, ProductId } from '@app/catalog';
import {
  GetMovementById, GetMovementHistory, RecordMovement, RecordMovementBatch, ReverseMovement,
  type MovementId, type NodeId,
} from '@app/inventory';
import type { RequestContext } from '@app/tenancy';
import { Ctx } from '../pipeline/params.decorators.js';
import { InvalidFilterError, parsePage } from '../shared/cursor-query.js';
import { ProblemDetailsView } from '../shared/shared.dto.js';
import { movementView, pageView, stockPositionView } from '../shared/views.js';
import { UuidParam } from '../shared/uuid-param.pipe.js';
import {
  CreateMovementDto, MovementPageView, MovementView, RecordMovementBatchDto,
  RecordedBatchView, RecordedMovementView, ReverseMovementDto,
} from './movements.dto.js';

/**
 * Only `occurredAt`, and descending by default (decision D-37). It is the one
 * indexed column, and this is the table that grows fastest in the system:
 * offering the sorts the other listings offer would invite a seq scan over it.
 * Descending because whoever opens a history wants the last thing first.
 */
const PAGE_OPTIONS = {
  sortable: ['occurredAt'],
  defaultSort: '-occurredAt',
  filters: ['productId', 'nodeId', 'batchId', 'actorId', 'from', 'to'],
} as const;

const recorded = (r: { movement: Parameters<typeof movementView>[0]; balances: Parameters<typeof stockPositionView>[0][] }) => ({
  movement: movementView(r.movement),
  balances: r.balances.map(stockPositionView),
});

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('movements')
export class MovementsController {
  constructor(
    private readonly record: RecordMovement,
    private readonly recordBatch: RecordMovementBatch,
    private readonly reverse: ReverseMovement,
    private readonly history: GetMovementHistory,
    private readonly byId: GetMovementById,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'El histórico de movimientos',
    description:
      'Filtros: productId, nodeId (casa origen o destino), batchId, actorId, from y to sobre occurredAt. Ordena solo por occurredAt, lo último primero.',
  })
  @ApiOkResponse({ type: MovementPageView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'invalid-filter' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  async list(
    @Ctx() ctx: RequestContext,
    @Query() query: Record<string, unknown>,
  ): Promise<MovementPageView> {
    const page = parsePage(query, PAGE_OPTIONS);
    const found = await this.history.execute(ctx, parseFilters(query), {
      ...page,
      sort: page.sort as { field: 'occurredAt'; dir: 'asc' | 'desc' },
    });
    return pageView(found, movementView);
  }

  @Post()
  @ApiOperation({
    summary: 'Registra un movimiento',
    description:
      'La partida doble del ledger: la cantidad sale de un nodo y entra en otro, en la misma transacción que actualiza los dos saldos.',
  })
  @ApiCreatedResponse({ type: RecordedMovementView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed · missing-idempotency-key' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found — producto, lote, nodo o el préstamo que se salda' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'movement-id-taken · idempotency-key-reuse' })
  @ApiResponse({
    status: 422,
    type: ProblemDetailsView,
    description:
      'insufficient-stock · same-node · non-positive-quantity · batch-required · batch-not-allowed · batch-product-mismatch · due-date-not-allowed · future-occurrence · node-inactive · reason-required · settles-required · settles-mismatch · settles-exceeded · serial-already-placed · product-inactive',
  })
  async create(
    @Ctx() ctx: RequestContext,
    @Body() dto: CreateMovementDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<RecordedMovementView> {
    const out = await this.record.execute(ctx, toInput(dto));
    void reply.header('Location', `/v1/movements/${out.movement.id}`);
    return recorded(out);
  }

  @Post('batch')
  @ApiOperation({
    summary: 'Registra un lote de movimientos',
    description:
      'Todo o nada, en una transacción. Es lo que usa la carga de saldo inicial desde una hoja de cálculo.',
  })
  @ApiCreatedResponse({ type: RecordedBatchView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed · missing-idempotency-key' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'movement-id-taken · idempotency-key-reuse' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'batch-too-large · insufficient-stock · y las demás del asiento' })
  async batch(
    @Ctx() ctx: RequestContext,
    @Body() dto: RecordMovementBatchDto,
  ): Promise<RecordedBatchView> {
    const out = await this.recordBatch.execute(ctx, { movements: dto.movements.map(toInput) });
    return { movements: out.movements.map(movementView), balances: out.balances.map(stockPositionView) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Un movimiento por id' })
  @ApiOkResponse({ type: MovementView })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  async one(@Ctx() ctx: RequestContext, @Param('id', UuidParam) id: string): Promise<MovementView> {
    return movementView(await this.byId.execute(ctx, id as MovementId));
  }

  @Post(':id/reverse')
  // 201 and not 200: a compensation *is* a new resource — one more entry in the
  // ledger, with its own id and its own row in the history (decision D-40).
  @ApiOperation({
    summary: 'Compensa un movimiento',
    description:
      'La única forma de deshacer un asiento, porque los movimientos no se actualizan ni se borran (I-3). Puede fallar por saldo: el sistema no inventa existencias para cuadrar una corrección.',
  })
  @ApiCreatedResponse({ type: RecordedMovementView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed · missing-idempotency-key' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'already-reversed · idempotency-key-reuse' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'insufficient-stock' })
  async compensate(
    @Ctx() ctx: RequestContext,
    @Param('id', UuidParam) id: string,
    @Body() dto: ReverseMovementDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<RecordedMovementView> {
    const out = await this.reverse.execute(ctx, { movementId: id as MovementId, reason: dto.reason });
    void reply.header('Location', `/v1/movements/${out.reversal.id}`);
    return recorded({ movement: out.reversal, balances: out.balances });
  }
}

const toInput = (dto: CreateMovementDto) => ({
  ...(dto.id !== undefined ? { id: dto.id as MovementId } : {}),
  productId: dto.productId as ProductId,
  ...(dto.batchId !== undefined ? { batchId: dto.batchId as BatchId } : {}),
  fromNodeId: dto.fromNodeId as NodeId,
  toNodeId: dto.toNodeId as NodeId,
  quantity: dto.quantity,
  occurredAt: new Date(dto.occurredAt),
  ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
  ...(dto.dueAt !== undefined ? { dueAt: new Date(dto.dueAt) } : {}),
  ...(dto.settlesId !== undefined ? { settlesId: dto.settlesId as MovementId } : {}),
  ...(dto.processInstanceId !== undefined ? { processInstanceId: dto.processInstanceId as never } : {}),
});

/** The six declared filters, parsed and validated at the edge (spec 03 §8). */
function parseFilters(query: Record<string, unknown>) {
  const out: {
    productId?: ProductId; nodeId?: NodeId; batchId?: BatchId; actorId?: UserId;
    from?: Date; to?: Date;
  } = {};

  for (const key of ['productId', 'nodeId', 'batchId', 'actorId'] as const) {
    const raw = query[key];
    if (raw === undefined) continue;
    if (typeof raw !== 'string' || raw === '') throw new InvalidFilterError(key, `"${key}" debe ser un id`);
    out[key] = raw as never;
  }
  for (const key of ['from', 'to'] as const) {
    const raw = query[key];
    if (raw === undefined) continue;
    const when = typeof raw === 'string' ? new Date(raw) : new Date(Number.NaN);
    if (Number.isNaN(when.getTime())) throw new InvalidFilterError(key, `"${key}" debe ser una fecha ISO 8601`);
    out[key] = when;
  }
  return out;
}
