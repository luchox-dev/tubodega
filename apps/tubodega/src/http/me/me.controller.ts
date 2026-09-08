import { Body, Controller, Get, HttpCode, Inject, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  ChangePassword,
  ORGANIZATION_REPOSITORY,
  USER_REPOSITORY,
  type OrganizationRepository,
  type RequestContext,
  type UserRepository,
} from '@app/tenancy';
import { ChangePasswordDto } from '../users/users.dto.js';
import { Ctx } from '../pipeline/params.decorators.js';
import { MeView } from './me.dto.js';
import { ProblemDetailsView } from '../shared/shared.dto.js';
import { organizationView, userView } from '../shared/views.js';

@ApiTags('tenancy')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
    private readonly changePassword: ChangePassword,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Usuario y organización del token' })
  @ApiOkResponse({ type: MeView })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials · token-expired' })
  async me(@Ctx() ctx: RequestContext): Promise<MeView> {
    const [user, organization] = await Promise.all([
      this.users.findById(ctx.orgId, ctx.userId),
      this.organizations.findById(ctx.orgId),
    ]);
    // Both exist: the identity interceptor just loaded the user inside this transaction.
    return { user: userView(user!), organization: organizationView(organization!) };
  }

  @Post('password')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Cambia la propia contraseña',
    description: 'Exige la contraseña actual. Las sesiones abiertas siguen siendo válidas.',
  })
  @ApiNoContentResponse()
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed · missing-idempotency-key' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'idempotency-key-reuse' })
  async password(@Ctx() ctx: RequestContext, @Body() dto: ChangePasswordDto): Promise<void> {
    await this.changePassword.execute(ctx, dto);
  }
}
