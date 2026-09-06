import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { validate } from '@app/common';
import { TenancyModule } from '@app/tenancy';
import { AdaptersModule } from './adapters/adapters.module.js';
import { AuthGuard } from './http/auth/auth.guard.js';
import { IdentityInterceptor } from './http/identity/identity.interceptor.js';
import { OpenApiController, OpenApiDocument } from './http/openapi/openapi.js';
import { DomainErrorFilter } from './http/problem/domain-error.filter.js';
import { AuthController } from './http/tenancy/auth.controller.js';
import { MeController } from './http/tenancy/me.controller.js';
import { OrganizationsController } from './http/tenancy/organizations.controller.js';
import { TransactionInterceptor } from './http/tx/transaction.interceptor.js';

/**
 * Composition root. The order of the global interceptors is the order of the
 * request of spec 07 §3 and is not cosmetic: the transaction (and SET LOCAL)
 * must be open before identity is loaded.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true, validate }),
    AdaptersModule,
    TenancyModule,
  ],
  controllers: [OrganizationsController, AuthController, MeController, OpenApiController],
  providers: [
    OpenApiDocument,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TransactionInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdentityInterceptor },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule {}
