import { Controller, Get, Inject } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ORGANIZATION_REPOSITORY,
  USER_REPOSITORY,
  type OrganizationRepository,
  type RequestContext,
  type UserRepository,
} from '@app/tenancy';
import { Ctx } from '../context/ctx.decorator.js';
import { MeView, ProblemDetailsView } from './dto.js';
import { organizationView, userView } from './views.js';

@ApiTags('tenancy')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    @Inject(USER_REPOSITORY) private readonly users: UserRepository,
    @Inject(ORGANIZATION_REPOSITORY) private readonly organizations: OrganizationRepository,
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
}
