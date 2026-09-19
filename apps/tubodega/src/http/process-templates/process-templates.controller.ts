import { Body, Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import {
  ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { CreateTemplateVersion, GetActiveTemplate, ListTemplates } from '@app/process';
import type { RequestContext } from '@app/tenancy';
import { Ctx } from '../pipeline/params.decorators.js';
import { InvalidFilterError } from '../shared/cursor-query.js';
import { ProblemDetailsView } from '../shared/shared.dto.js';
import { processTemplateView } from '../shared/views.js';
import {
  CreateTemplateVersionDto, ProcessTemplateListView, ProcessTemplateView,
} from './process-templates.dto.js';

/**
 * What the operation can be guided through. A generic client reads a template
 * and then follows what the server tells it step by step — it never needs to
 * know what a receipt is.
 */
@ApiTags('process')
@ApiBearerAuth()
@Controller('process-templates')
export class ProcessTemplatesController {
  constructor(
    private readonly listTemplates: ListTemplates,
    private readonly getActive: GetActiveTemplate,
    private readonly createVersion: CreateTemplateVersion,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Los procesos que esta organización sabe ejecutar',
    description:
      'Solo las versiones activas. Sin cursor y sin filtros: son seis, y el día que se puedan editar por organización seguirán siendo pocas.',
  })
  @ApiOkResponse({ type: ProcessTemplateListView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'invalid-filter' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  async list(
    @Ctx() ctx: RequestContext,
    @Query() query: Record<string, unknown>,
  ): Promise<ProcessTemplateListView> {
    // Decision D-60, closing D-59. This collection does not paginate — they are
    // six — so there is no `parsePage` to refuse an unknown key, and until now
    // it swallowed `?limit=2` in silence: the one collection of the contract
    // that answered something other than `400 invalid-filter` to a key it does
    // not know. A guard, and not `parsePage`, because pagination is the thing
    // this resource deliberately does not want.
    const key = Object.keys(query)[0];
    if (key !== undefined) throw new InvalidFilterError(key);
    return { data: (await this.listTemplates.execute(ctx)).map(processTemplateView) };
  }

  @Get(':code')
  @ApiOperation({
    summary: 'La versión activa de una plantilla',
    description:
      'Por código de negocio —RECEPCION, TRASLADO…—, que no es un uuid. Un código sin versión activa no está, igual que uno que no existe.',
  })
  @ApiOkResponse({ type: ProcessTemplateView })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'template-not-found' })
  // `code` is not a uuid, so `UuidParam` does not apply here: a code that does
  // not exist is the use case's 404, not the pipe's.
  async one(@Ctx() ctx: RequestContext, @Param('code') code: string): Promise<ProcessTemplateView> {
    return processTemplateView(await this.getActive.execute(ctx, code));
  }

  @Post(':code/versions')
  @ApiOperation({
    summary: 'Publica una versión nueva de una plantilla',
    description:
      'P-9: nunca se edita una versión, se crea la siguiente y se desactiva la anterior. Los procesos ya abiertos siguen con la suya y terminan con las reglas con las que nacieron.',
  })
  @ApiCreatedResponse({ type: ProcessTemplateView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed · missing-idempotency-key' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'template-not-found' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'template-version-taken · idempotency-key-reuse' })
  @ApiResponse({
    status: 422,
    type: ProblemDetailsView,
    description: 'branching-not-supported · unknown-step-type · invalid-template',
  })
  async version(
    @Ctx() ctx: RequestContext,
    @Param('code') code: string,
    @Body() dto: CreateTemplateVersionDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ProcessTemplateView> {
    const created = await this.createVersion.execute(ctx, {
      code, version: dto.version, steps: dto.steps,
    });
    void reply.header('Location', `/v1/process-templates/${created.code}`);
    return processTemplateView(created);
  }
}
