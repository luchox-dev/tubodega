import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Authenticate } from '@app/tenancy';
import { Public } from '../pipeline/public.decorator.js';
import { LoginDto, TokenPairView } from './auth.dto.js';
import { ProblemDetailsView } from '../shared/shared.dto.js';
import { userView } from '../shared/views.js';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authenticate: Authenticate) {}

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
}
