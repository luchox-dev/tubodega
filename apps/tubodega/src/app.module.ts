import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { validate } from '@app/common';
import { TenancyModule } from '@app/tenancy';
import { AdaptersModule } from './adapters/adapters.module.js';
import { AuthController } from './http/auth/auth.controller.js';
import { MeController } from './http/me/me.controller.js';
import { OpenApiController, OpenApiDocument } from './http/openapi/openapi.controller.js';
import { OrganizationsController } from './http/organizations/organizations.controller.js';
import { AuthGuard } from './http/pipeline/auth.guard.js';
import { DomainErrorFilter } from './http/pipeline/domain-error.filter.js';
import { IdentityInterceptor } from './http/pipeline/identity.interceptor.js';
import { IdempotencyInterceptor } from './http/pipeline/idempotency.interceptor.js';
import { IdempotencyStore } from './http/pipeline/idempotency.store.js';
import { TransactionInterceptor } from './http/pipeline/transaction.interceptor.js';

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
    IdempotencyStore,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TransactionInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdentityInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule {}
