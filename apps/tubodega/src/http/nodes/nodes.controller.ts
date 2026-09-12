import {
  Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, Res,
} from '@nestjs/common';
import {
  ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation,
  ApiResponse, ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import {
  CreateNode, DeactivateNode, GetNode, GetNodeTree, ListNodes, MoveNode, NodeKind, UpdateNode,
  type NodeId,
} from '@app/inventory';
import type { RequestContext } from '@app/tenancy';
import { Ctx } from '../pipeline/params.decorators.js';
import { InvalidFilterError, parsePage } from '../shared/cursor-query.js';
import { parseIfMatch } from '../shared/if-match.js';
import { ProblemDetailsView } from '../shared/shared.dto.js';
import { nodeTreeView, nodeView, pageView } from '../shared/views.js';
import { UuidParam } from '../shared/uuid-param.pipe.js';
import {
  CreateNodeDto, MoveNodeDto, NodePageView, NodeTreeView, NodeView, UpdateNodeDto,
} from './nodes.dto.js';

/** `path` by default: it is the only order that reads like a warehouse, and
 *  node_org_id_path_idx backs it. */
const PAGE_OPTIONS = {
  sortable: ['path', 'code', 'name', 'createdAt'],
  defaultSort: 'path',
  filters: ['kind', 'active', 'under'],
} as const;

type Sort = Parameters<ListNodes['execute']>[1]['sort'];

@ApiTags('inventory')
@ApiBearerAuth()
@Controller('nodes')
export class NodesController {
  constructor(
    private readonly createNode: CreateNode,
    private readonly updateNode: UpdateNode,
    private readonly moveNode: MoveNode,
    private readonly deactivateNode: DeactivateNode,
    private readonly getNode: GetNode,
    private readonly listNodes: ListNodes,
    private readonly getTree: GetNodeTree,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Los nodos de la organización',
    description:
      'Filtros: kind, active y under (el subárbol estricto de un nodo). Ordena por path, code, name o createdAt.',
  })
  @ApiOkResponse({ type: NodePageView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'invalid-filter' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  async list(
    @Ctx() ctx: RequestContext,
    @Query() query: Record<string, unknown>,
  ): Promise<NodePageView> {
    const page = parsePage(query, PAGE_OPTIONS);
    const found = await this.listNodes.execute(ctx, {
      ...page,
      sort: page.sort as Sort,
      ...parseFilters(query),
    });
    return pageView(found, nodeView);
  }

  @Post()
  @ApiOperation({
    summary: 'Dibuja un nodo',
    description: 'Con parentId cuelga de una ubicación interna; sin él nace en la raíz.',
  })
  @ApiCreatedResponse({ type: NodeView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed · missing-idempotency-key' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'node-code-taken · idempotency-key-reuse' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'parent-not-internal · parent-not-found · invalid-node-code · invalid-custom-field' })
  async create(
    @Ctx() ctx: RequestContext,
    @Body() dto: CreateNodeDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<NodeView> {
    const { parentId, ...rest } = dto;
    const node = await this.createNode.execute(ctx, {
      ...rest,
      ...(parentId !== undefined ? { parentId: parentId as NodeId } : {}),
    });
    void reply.header('Location', `/v1/nodes/${node.id}`);
    return nodeView(node);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Un nodo por id' })
  @ApiOkResponse({ type: NodeView })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  async one(@Ctx() ctx: RequestContext, @Param('id', UuidParam) id: string): Promise<NodeView> {
    return nodeView(await this.getNode.execute(ctx, id as NodeId));
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Renombra un nodo o cambia sus campos propios',
    description:
      'Exige If-Match. No admite kind, code ni parentId: el tipo está desnormalizado en el histórico, el código es el segmento del path, y el padre se cambia con POST /v1/nodes/{id}/move.',
  })
  @ApiOkResponse({ type: NodeView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'missing-if-match · validation-failed' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'stale-version' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'invalid-custom-field' })
  async patch(
    @Ctx() ctx: RequestContext,
    @Param('id', UuidParam) id: string,
    @Body() dto: UpdateNodeDto,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<NodeView> {
    // Destructured and not spread: the three immutable fields are typed `never`
    // so they cannot reach the use case even by accident.
    const { name, customFields } = dto;
    const node = await this.updateNode.execute(ctx, {
      id: id as NodeId,
      ...(name !== undefined ? { name } : {}),
      ...(customFields !== undefined ? { customFields } : {}),
      expectedVersion: parseIfMatch(ifMatch),
    });
    return nodeView(node);
  }

  @Post(':id/move')
  @ApiOperation({
    summary: 'Reasigna el padre de un nodo',
    description:
      'Exige If-Match. Recalcula el path del nodo y el de todo su subárbol en la misma transacción (N-1, N-2).',
  })
  @ApiOkResponse({ type: NodeView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'missing-if-match · validation-failed · missing-idempotency-key' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'stale-version · idempotency-key-reuse' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'node-cycle · parent-not-internal · parent-not-found' })
  async move(
    @Ctx() ctx: RequestContext,
    @Param('id', UuidParam) id: string,
    @Body() dto: MoveNodeDto,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<NodeView> {
    const node = await this.moveNode.execute(ctx, {
      id: id as NodeId,
      ...(dto.parentId !== undefined ? { parentId: dto.parentId as NodeId } : {}),
      expectedVersion: parseIfMatch(ifMatch),
    });
    return nodeView(node);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Retira un nodo',
    description:
      'Lo desactiva, no lo borra: el histórico de movimientos lo sigue nombrando. Con saldo o con hijos activos, no.',
  })
  @ApiNoContentResponse()
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'node-has-stock · node-has-children' })
  async remove(@Ctx() ctx: RequestContext, @Param('id', UuidParam) id: string): Promise<void> {
    await this.deactivateNode.execute(ctx, id as NodeId);
  }

  @Get(':id/tree')
  @ApiOperation({
    summary: 'El subárbol de un nodo, anidado',
    description:
      'Incluye los nodos inactivos: omitir un estante retirado dejaría huérfanos a sus hijos. Sin cursor, con tope de 1000 nodos.',
  })
  @ApiOkResponse({ type: NodeTreeView })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'tree-too-large' })
  async tree(@Ctx() ctx: RequestContext, @Param('id', UuidParam) id: string): Promise<NodeTreeView> {
    return nodeTreeView(await this.getTree.execute(ctx, id as NodeId));
  }
}

/** The three declared filters, parsed and validated at the edge (spec 03 §8). */
function parseFilters(query: Record<string, unknown>) {
  const out: { kind?: NodeKind; active?: boolean; under?: NodeId } = {};

  if (query.kind !== undefined) {
    if (!Object.values(NodeKind).includes(query.kind as NodeKind)) {
      throw new InvalidFilterError('kind', `"kind" debe ser uno de ${Object.values(NodeKind).join(', ')}`);
    }
    out.kind = query.kind as NodeKind;
  }
  if (query.active !== undefined) {
    if (query.active !== 'true' && query.active !== 'false') {
      throw new InvalidFilterError('active', '"active" debe ser true o false');
    }
    out.active = query.active === 'true';
  }
  if (query.under !== undefined) {
    if (typeof query.under !== 'string' || query.under === '') {
      throw new InvalidFilterError('under', '"under" debe ser el id de un nodo');
    }
    out.under = query.under as NodeId;
  }
  return out;
}
