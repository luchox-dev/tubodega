import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Authenticate, Logout, RefreshSession, type RequestContext } from '@app/tenancy';
import { IdempotencyExempt } from '../pipeline/idempotency-exempt.decorator.js';
import { Ctx } from '../pipeline/params.decorators.js';
import { Public } from '../pipeline/public.decorator.js';
import { LoginDto, RefreshDto, TokenPairView, TokenRotationView } from './auth.dto.js';
import { ProblemDetailsView } from '../shared/shared.dto.js';
import { userView } from '../shared/views.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authenticate: Authenticate,
    private readonly refreshSession: RefreshSession,
    private readonly logout: Logout,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Inicio de sesión', description: 'Devuelve el par de tokens. Exento de Idempotency-Key.' })
  @ApiOkResponse({ type: TokenPairView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 409, type: ProblemDetailsView, description: 'ambiguous-login' })
  async login(@Body() dto: LoginDto): Promise<TokenPairView> {
    const out = await this.authenticate.execute(dto);
    return { accessToken: out.accessToken, refreshToken: out.refreshToken, expiresIn: out.expiresIn, user: userView(out.user) };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rota el par de tokens',
    description:
      'El token de refresco es de un solo uso: al usarlo queda revocado. Exento de Idempotency-Key.',
  })
  @ApiOkResponse({ type: TokenRotationView })
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'refresh-token-invalid' })
  refresh(@Body() dto: RefreshDto): Promise<TokenRotationView> {
    return this.refreshSession.execute(dto);
  }

  @IdempotencyExempt()
  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cierra la sesión',
    description: 'Revoca el token de refresco propio. Responde igual si no existe. Exento de Idempotency-Key.',
  })
  @ApiNoContentResponse()
  @ApiResponse({ status: 400, type: ProblemDetailsView, description: 'validation-failed' })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  async signOut(@Ctx() ctx: RequestContext, @Body() dto: RefreshDto): Promise<void> {
    await this.logout.execute(ctx, dto);
  }
}
