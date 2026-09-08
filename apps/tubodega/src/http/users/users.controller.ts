import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import type { UserId } from '@app/common';
import {
  CreateUser,
  DeactivateUser,
  GetUser,
  ListUsers,
  Role,
  UpdateUserRoles,
  type RequestContext,
} from '@app/tenancy';
import { Ctx } from '../pipeline/params.decorators.js';
import { InvalidFilterError, parsePage } from '../shared/cursor-query.js';
import { parseIfMatch } from '../shared/if-match.js';
import { ProblemDetailsView, UserView } from '../shared/shared.dto.js';
import { pageView, userView } from '../shared/views.js';
import { UuidParam } from '../shared/uuid-param.pipe.js';
import { CreateUserDto, UpdateUserRolesDto, UserPageView } from './users.dto.js';

/** Everything here needs MANAGE_USERS; the use cases check it (spec 10 §7). */
const PAGE_OPTIONS = {
  sortable: ['name', 'email'],
  defaultSort: 'name',
  filters: ['active', 'role'],
} as const;

@ApiTags('tenancy')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(
    private readonly createUser: CreateUser,
    private readonly listUsers: ListUsers,
    private readonly getUser: GetUser,
    private readonly updateUserRoles: UpdateUserRoles,
    private readonly deactivateUser: DeactivateUser,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista los usuarios de la organización', description: 'Filtros: active, role. Orden: name, email.' })
  @ApiOkResponse({ type: UserPageView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'invalid-filter' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials · token-expired' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  async list(@Ctx() ctx: RequestContext, @Query() query: Record<string, unknown>): Promise<UserPageView> {
    const page = parsePage(query, PAGE_OPTIONS);
    const found = await this.listUsers.execute(ctx, {
      ...page,
      sort: page.sort as { field: 'name' | 'email'; dir: 'asc' | 'desc' },
      ...parseFilters(query),
    });
    return pageView(found, userView);
  }

  @Post()
  @ApiOperation({ summary: 'Da de alta a una persona del equipo' })
  @ApiCreatedResponse({ type: UserView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed · missing-idempotency-key' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'email-taken · idempotency-key-reuse · idempotency-key-in-flight' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'invalid-email' })
  async create(
    @Ctx() ctx: RequestContext,
    @Body() dto: CreateUserDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<UserView> {
    const user = await this.createUser.execute(ctx, dto);
    void reply.header('Location', `/v1/users/${user.id}`);
    return userView(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Un usuario por id' })
  @ApiOkResponse({ type: UserView })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found · también para otra organización (I-6)' })
  async get(@Ctx() ctx: RequestContext, @Param('id', UuidParam) id: string): Promise<UserView> {
    return userView(await this.getUser.execute(ctx, { id: id as UserId }));
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Cambia los roles', description: 'Exige If-Match con la versión del usuario.' })
  @ApiOkResponse({ type: UserView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'missing-if-match · validation-failed' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'stale-version' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'last-owner' })
  async patch(
    @Ctx() ctx: RequestContext,
    @Param('id', UuidParam) id: string,
    @Body() dto: UpdateUserRolesDto,
    @Headers('if-match') ifMatch: string | undefined,
  ): Promise<UserView> {
    const user = await this.updateUserRoles.execute(ctx, {
      id: id as UserId,
      roles: dto.roles,
      expectedVersion: parseIfMatch(ifMatch),
    });
    return userView(user);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Desactiva a una persona', description: 'No borra: los movimientos referencian a su actor.' })
  @ApiNoContentResponse()
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'not-found' })
  @ApiResponse({ status: 422, type: ProblemDetailsView, description: 'last-owner' })
  async remove(@Ctx() ctx: RequestContext, @Param('id', UuidParam) id: string): Promise<void> {
    await this.deactivateUser.execute(ctx, { id: id as UserId });
  }
}

/** Query values arrive as strings; only the declared ones reach here. */
function parseFilters(query: Record<string, unknown>): { active?: boolean; role?: Role } {
  const out: { active?: boolean; role?: Role } = {};
  if (query.active !== undefined) {
    if (query.active !== 'true' && query.active !== 'false') {
      throw new InvalidFilterError('active', '"active" debe ser true o false');
    }
    out.active = query.active === 'true';
  }
  if (query.role !== undefined) {
    if (!Object.values(Role).includes(query.role as Role)) {
      throw new InvalidFilterError('role', `"role" debe ser uno de ${Object.values(Role).join(', ')}`);
    }
    out.role = query.role as Role;
  }
  return out;
}
