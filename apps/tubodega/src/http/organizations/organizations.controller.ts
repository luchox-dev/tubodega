import { Body, Controller, HttpCode, Post, Res } from '@nestjs/common';
import { ApiCreatedResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { TraceId } from '@app/common';
import { CreateOrganization } from '@app/tenancy';
import { Public } from '../pipeline/public.decorator.js';
import { Trace } from '../pipeline/params.decorators.js';
import { CreateOrganizationDto, OrganizationCreatedView } from './organizations.dto.js';
import { ProblemDetailsView } from '../shared/shared.dto.js';
import { organizationView, userView } from '../shared/views.js';

@ApiTags('tenancy')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly createOrganization: CreateOrganization) {}

  @Public()
  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Registro de una organización con su primer OWNER', description: 'Exento de Idempotency-Key (spec 07 §5).' })
  @ApiCreatedResponse({ type: OrganizationCreatedView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'slug-taken' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'invalid-slug · invalid-email' })
  async create(
    @Body() dto: CreateOrganizationDto,
    @Trace() traceId: TraceId,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OrganizationCreatedView> {
    const { organization, owner } = await this.createOrganization.execute(dto, traceId);
    reply.header('Location', `/v1/organizations/${organization.id}`);
    return { organization: organizationView(organization), owner: userView(owner) };
  }
}
