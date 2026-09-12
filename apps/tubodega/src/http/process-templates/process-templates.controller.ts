import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { GetActiveTemplate, ListTemplates } from '@app/process';
import type { RequestContext } from '@app/tenancy';
import { Ctx } from '../pipeline/params.decorators.js';
import { ProblemDetailsView } from '../shared/shared.dto.js';
import { processTemplateView } from '../shared/views.js';
import { ProcessTemplateListView, ProcessTemplateView } from './process-templates.dto.js';

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
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Los procesos que esta organización sabe ejecutar',
    description:
      'Solo las versiones activas. Sin cursor y sin filtros: son seis, y el día que se puedan editar por organización seguirán siendo pocas.',
  })
  @ApiOkResponse({ type: ProcessTemplateListView })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  async list(@Ctx() ctx: RequestContext): Promise<ProcessTemplateListView> {
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
}
