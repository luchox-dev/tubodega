import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CodeNotFoundError, ResolveCode } from '@app/catalog';
import type { RequestContext } from '@app/tenancy';
import { Ctx } from '../pipeline/params.decorators.js';
import { ResolvedCodeView } from '../products/products.dto.js';
import { ProblemDetailsView } from '../shared/shared.dto.js';
import { batchView, productView } from '../shared/views.js';

/**
 * Outside `/products` on purpose: the client that scans does not yet know
 * whether the code belongs to a product or to a unit, and that ignorance is
 * exactly what this endpoint resolves (spec 11 §7).
 */
@ApiTags('catalog')
@ApiBearerAuth()
@Controller('codes')
export class CodesController {
  constructor(private readonly resolve: ResolveCode) {}

  @Get(':value/resolve')
  @ApiOperation({
    summary: 'Resuelve un escaneo',
    description:
      'Busca en los códigos del producto, luego en los números de serie y por último en el SKU. El código de lote no se resuelve aquí: es único por producto, no por organización, y sin producto es ambiguo.',
  })
  @ApiOkResponse({ type: ResolvedCodeView })
  @ApiResponse({ status: 401, type: ProblemDetailsView, description: 'invalid-credentials' })
  @ApiResponse({ status: 403, type: ProblemDetailsView, description: 'insufficient-role' })
  @ApiResponse({ status: 404, type: ProblemDetailsView, description: 'code-not-found' })
  async resolveCode(@Ctx() ctx: RequestContext, @Param('value') value: string): Promise<ResolvedCodeView> {
    const found = await this.resolve.execute(ctx, value);
    // The use case returns null because not finding a code is a normal result;
    // over HTTP the client asked for a resource, so it is a 404 (D-10).
    if (!found) throw new CodeNotFoundError(value);
    return {
      product: productView(found.product),
      ...(found.batch !== undefined ? { batch: batchView(found.batch) } : {}),
    };
  }
}
