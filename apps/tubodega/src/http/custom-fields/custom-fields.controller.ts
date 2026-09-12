import { Body, Controller, Get, Headers, Param, Patch, Post, Query, Res } from '@nestjs/common';
import {
  ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags,
} from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import {
  CustomEntity, DefineCustomField, ListCustomFields, UpdateCustomField, type CustomFieldId,
} from '@app/catalog';
import type { RequestContext } from '@app/tenancy';
import { Ctx } from '../pipeline/params.decorators.js';
import { InvalidFilterError } from '../shared/cursor-query.js';
import { parseIfMatch } from '../shared/if-match.js';
import { ProblemDetailsView } from '../shared/shared.dto.js';
import { customFieldView } from '../shared/views.js';
import { UuidParam } from '../shared/uuid-param.pipe.js';
import {
  CustomFieldListView, CustomFieldView, DefineCustomFieldDto, UpdateCustomFieldDto,
} from './custom-fields.dto.js';

const ALLOWED_QUERY = ['entity'];

@ApiTags('catalog')
@ApiBearerAuth()
@Controller('custom-fields')
export class CustomFieldsController {
  constructor(
    private readonly define: DefineCustomField,
    private readonly list: ListCustomFields,
    private readonly update: UpdateCustomField,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Los campos propios de la organización', description: 'Filtro: entity (por defecto PRODUCT). Ordenados por position.' })
  @ApiOkResponse({ type: CustomFieldListView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'invalid-filter' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  async listFields(
    @Ctx() ctx: RequestContext,
    @Query() query: Record<string, unknown>,
  ): Promise<CustomFieldListView> {
    for (const key of Object.keys(query)) {
      if (!ALLOWED_QUERY.includes(key)) throw new InvalidFilterError(key);
    }
    const entity = query.entity ?? CustomEntity.PRODUCT;
    if (!Object.values(CustomEntity).includes(entity as CustomEntity)) {
      throw new InvalidFilterError('entity', `"entity" debe ser uno de ${Object.values(CustomEntity).join(', ')}`);
    }
    return { data: (await this.list.execute(ctx, entity as CustomEntity)).map(customFieldView) };
  }

  @Post()
  @ApiOperation({
    summary: 'Define un campo propio',
    description: 'Un campo nace opcional y se vuelve obligatorio cuando todas las entidades lo tienen (C-10).',
  })
  @ApiCreatedResponse({ type: CustomFieldView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed · missing-idempotency-key' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'idempotency-key-reuse' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'required-field-would-invalidate · invalid-custom-field · validation-failed' })
  async defineField(
    @Ctx() ctx: RequestContext,
    @Body() dto: DefineCustomFieldDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<CustomFieldView> {
    const def = await this.define.execute(ctx, dto);
    void reply.header('Location', `/v1/custom-fields/${def.id}`);
    return customFieldView(def);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Modifica una definición',
    description: 'Exige If-Match. El tipo solo cambia mientras ninguna entidad tenga valor (D-10).',
  })
  @ApiOkResponse({ type: CustomFieldView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'missing-if-match · validation-failed' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'stale-version' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'custom-field-type-locked · required-field-would-invalidate' })
  async patchField(
    @Ctx() ctx: RequestContext,
    @Param('id', UuidParam) id: string,
    @Body() dto: UpdateCustomFieldDto,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<CustomFieldView> {
    const def = await this.update.execute(ctx, {
      id: id as CustomFieldId,
      ...dto,
      expectedVersion: parseIfMatch(ifMatch),
    });
    return customFieldView(def);
  }
}
