import { Body, Controller, Get, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import {
  ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { ProcessInstanceId, UserId } from '@app/common';
import {
  CancelProcess, CompleteStep, GetProcessInstance, ListProcessInstances, ProcessState, StartProcess,
  type StepId, type TemplateCode,
} from '@app/process';
import type { RequestContext } from '@app/tenancy';
import { Ctx } from '../pipeline/params.decorators.js';
import { InvalidFilterError, parsePage } from '../shared/cursor-query.js';
import { ProblemDetailsView } from '../shared/shared.dto.js';
import { movementView, pageView, processInstanceView, stepCompletionView, stepView } from '../shared/views.js';
import { UuidParam } from '../shared/uuid-param.pipe.js';
import {
  CompletedStepView, CompleteStepDto, ProcessInstanceDetailView, ProcessInstancePageView,
  ProcessInstanceView, StartedProcessView, StartProcessDto,
} from './process-instances.dto.js';

/**
 * `createdAt` and nothing else, newest first (decision D-62, the mould of
 * D-37): it is the one indexed column, and this table grows with every guided
 * operation. Newest first because whoever opens "what is still open" wants the
 * last thing first.
 */
const PAGE_OPTIONS = {
  sortable: ['createdAt'],
  defaultSort: '-createdAt',
  filters: ['state', 'templateCode', 'actorId'],
} as const;

/**
 * Running a process. The client never reads the template: it opens an instance,
 * the server tells it which step comes next, and it sends that step back. That
 * is what lets one generic client run all six operations — and any that get
 * added — without knowing what a receipt is (spec 13 §10).
 */
@ApiTags('process')
@ApiBearerAuth()
@Controller('process-instances')
export class ProcessInstancesController {
  constructor(
    private readonly start: StartProcess,
    private readonly complete: CompleteStep,
    private readonly cancel: CancelProcess,
    private readonly get: GetProcessInstance,
    private readonly list: ListProcessInstances,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Los procesos de la organización',
    description:
      'Filtros: state, templateCode y actorId. Ordena solo por createdAt, lo último primero.',
  })
  @ApiOkResponse({ type: ProcessInstancePageView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'invalid-filter' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  async listing(
    @Ctx() ctx: RequestContext,
    @Query() query: Record<string, unknown>,
  ): Promise<ProcessInstancePageView> {
    const page = parsePage(query, PAGE_OPTIONS);
    const found = await this.list.execute(ctx, parseFilters(query), {
      ...page,
      sort: page.sort as { field: 'createdAt'; dir: 'asc' | 'desc' },
    });
    return pageView(found, processInstanceView);
  }

  @Post()
  @ApiOperation({
    summary: 'Abre un proceso',
    description:
      'Devuelve la definición del primer paso, no su id: el cliente sigue lo que el servidor le indica y nunca consulta la plantilla.',
  })
  @ApiCreatedResponse({ type: StartedProcessView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed · missing-idempotency-key' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'template-not-found' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'process-instance-id-taken · idempotency-key-reuse' })
  async open(
    @Ctx() ctx: RequestContext,
    @Body() dto: StartProcessDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<StartedProcessView> {
    const out = await this.start.execute(ctx, {
      templateCode: dto.templateCode,
      ...(dto.id !== undefined ? { id: dto.id as ProcessInstanceId } : {}),
    });
    void reply.header('Location', `/v1/process-instances/${out.instance.id}`);
    return { instance: processInstanceView(out.instance), nextStep: stepView(out.nextStep) };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Un proceso por id, con lo que ya se completó',
    description:
      'Mientras siga abierto trae además la definición del paso que espera, para poder retomarlo sin consultar la plantilla.',
  })
  @ApiOkResponse({ type: ProcessInstanceDetailView })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'process-instance-not-found' })
  async one(
    @Ctx() ctx: RequestContext,
    @Param('id', UuidParam) id: string,
  ): Promise<ProcessInstanceDetailView> {
    const out = await this.get.execute(ctx, id as ProcessInstanceId);
    return {
      instance: processInstanceView(out.instance),
      completions: out.completions.map(stepCompletionView),
      ...(out.currentStep ? { currentStep: stepView(out.currentStep) } : {}),
    };
  }

  @Post(':id/steps/:stepId/complete')
  @HttpCode(200)
  // 200 and not 201: completing a step creates no resource the client can go
  // and fetch. What it may create is a movement, and that one comes in the body.
  @ApiOperation({
    summary: 'Completa el paso actual',
    description:
      'El cuerpo lleva lo que ese paso pide. `payload: null` lo omite, si el paso lo admite. Al cerrar el proceso devuelve los asientos que produjo.',
  })
  @ApiOkResponse({ type: CompletedStepView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed · missing-idempotency-key' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'process-instance-not-found · not-found' })
  @ApiResponse({
    status: 409,
    type: ProblemDetailsView,
    description: 'wrong-step · step-already-completed · instance-closed · idempotency-key-reuse',
  })
  @ApiResponse({
    status: 422,
    type: ProblemDetailsView,
    description:
      'invalid-step-payload · required-step-skipped · incomplete-draft · batch-step-required · batch-step-not-allowed · upload-not-found · insufficient-stock · y las demás del asiento',
  })
  async step(
    @Ctx() ctx: RequestContext,
    @Param('id', UuidParam) id: string,
    @Param('stepId') stepId: string,
    @Body() dto: CompleteStepDto,
  ): Promise<CompletedStepView> {
    const out = await this.complete.execute(ctx, {
      instanceId: id as ProcessInstanceId,
      stepId: stepId as StepId,
      // Absent and explicitly null mean the same thing — omit the step — so a
      // client that sends `{}` and one that sends `{"payload":null}` get the
      // same answer instead of one of them getting a confusing 422.
      payload: dto.payload ?? null,
    });
    return {
      instance: processInstanceView(out.instance),
      ...(out.nextStep ? { nextStep: stepView(out.nextStep) } : {}),
      ...(out.movements ? { movements: out.movements.map(movementView) } : {}),
    };
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Abandona un proceso',
    description:
      'Sin efectos: un proceso a medias no deja rastro ni en el inventario ni en el catálogo (P-6). Conserva dónde se abandonó.',
  })
  @ApiOkResponse({ type: ProcessInstanceView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'missing-idempotency-key' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'process-instance-not-found' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'instance-closed · idempotency-key-reuse' })
  async abandon(
    @Ctx() ctx: RequestContext,
    @Param('id', UuidParam) id: string,
  ): Promise<ProcessInstanceView> {
    return processInstanceView(await this.cancel.execute(ctx, id as ProcessInstanceId));
  }
}

/** The three declared filters, parsed and validated at the edge (spec 03 §8). */
function parseFilters(query: Record<string, unknown>) {
  const out: { state?: ProcessState; templateCode?: TemplateCode; actorId?: UserId } = {};

  if (query.state !== undefined) {
    if (!Object.values(ProcessState).includes(query.state as ProcessState)) {
      throw new InvalidFilterError('state', `"state" debe ser uno de ${Object.values(ProcessState).join(', ')}`);
    }
    out.state = query.state as ProcessState;
  }
  if (query.templateCode !== undefined) {
    if (typeof query.templateCode !== 'string' || query.templateCode === '') {
      throw new InvalidFilterError('templateCode', '"templateCode" debe ser un código de plantilla');
    }
    out.templateCode = query.templateCode as TemplateCode;
  }
  if (query.actorId !== undefined) {
    if (typeof query.actorId !== 'string' || query.actorId === '') {
      throw new InvalidFilterError('actorId', '"actorId" debe ser el id de un usuario');
    }
    out.actorId = query.actorId as UserId;
  }
  return out;
}
