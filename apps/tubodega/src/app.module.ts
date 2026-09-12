import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { validate } from '@app/common';
import { CatalogModule } from '@app/catalog';
import { InventoryModule } from '@app/inventory';
import { ProcessModule } from '@app/process';
import { TenancyModule } from '@app/tenancy';
import { AdaptersModule } from './adapters/adapters.module.js';
import { AuthController } from './http/auth/auth.controller.js';
import { MeController } from './http/me/me.controller.js';
import { MovementsController } from './http/movements/movements.controller.js';
import { NodesController } from './http/nodes/nodes.controller.js';
import { ProcessTemplatesController } from './http/process-templates/process-templates.controller.js';
import { StockController } from './http/stock/stock.controller.js';
import { OpenApiController, OpenApiDocument } from './http/openapi/openapi.controller.js';
import { OrganizationsController } from './http/organizations/organizations.controller.js';
import { BatchesController } from './http/products/batches.controller.js';
import { CodesController } from './http/codes/codes.controller.js';
import { CustomFieldsController } from './http/custom-fields/custom-fields.controller.js';
import { ProductCodesController } from './http/products/product-codes.controller.js';
import { ProductMediaController } from './http/products/product-media.controller.js';
import { ProductsController } from './http/products/products.controller.js';
import { UploadsController } from './http/uploads/uploads.controller.js';
import { UsersController } from './http/users/users.controller.js';
import { OutboxDispatcherJob } from './jobs/outbox-dispatcher.job.js';
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
    ScheduleModule.forRoot(),
    AdaptersModule,
    TenancyModule,
    CatalogModule,
    InventoryModule,
    ProcessModule,
  ],
  controllers: [
    OrganizationsController,
    AuthController,
    UsersController,
    MeController,
    ProductsController,
    ProductCodesController,
    ProductMediaController,
    BatchesController,
    CodesController,
    CustomFieldsController,
    UploadsController,
    NodesController,
    MovementsController,
    StockController,
    ProcessTemplatesController,
    OpenApiController,
  ],
  providers: [
    OpenApiDocument,
    IdempotencyStore,
    OutboxDispatcherJob,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: TransactionInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdentityInterceptor },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule {}
