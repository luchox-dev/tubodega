import { Module } from '@nestjs/common';
import { AddProductCode } from './application/use-cases/add-product-code.js';
import { AttachMedia } from './application/use-cases/attach-media.js';
import { CreateBatch } from './application/use-cases/create-batch.js';
import { CreateProduct } from './application/use-cases/create-product.js';
import { DeactivateProduct } from './application/use-cases/deactivate-product.js';
import { DefineCustomField } from './application/use-cases/define-custom-field.js';
import { GetProduct } from './application/use-cases/get-product.js';
import { ImportProducts } from './application/use-cases/import-products.js';
import { ListBatches } from './application/use-cases/list-batches.js';
import { ListCodes } from './application/use-cases/list-codes.js';
import { ListCustomFields } from './application/use-cases/list-custom-fields.js';
import { ListMedia } from './application/use-cases/list-media.js';
import { ListProducts } from './application/use-cases/list-products.js';
import { RemoveMedia } from './application/use-cases/remove-media.js';
import { RemoveProductCode } from './application/use-cases/remove-product-code.js';
import { StageUpload } from './application/use-cases/stage-upload.js';
import { ResolveCode } from './application/use-cases/resolve-code.js';
import { UpdateCustomField } from './application/use-cases/update-custom-field.js';
import { UpdateProduct } from './application/use-cases/update-product.js';

/**
 * The catalogue use cases. Repositories, clock, ids, event publisher and the
 * two ledger ports are bound by the root application (spec 01 §6); they reach
 * here through a global module.
 */
const USE_CASES = [
  CreateProduct,
  UpdateProduct,
  DeactivateProduct,
  GetProduct,
  ListProducts,
  ImportProducts,
  AddProductCode,
  RemoveProductCode,
  ListCodes,
  ResolveCode,
  CreateBatch,
  ListBatches,
  DefineCustomField,
  UpdateCustomField,
  ListCustomFields,
  StageUpload,
  AttachMedia,
  RemoveMedia,
  ListMedia,
];

@Module({ providers: USE_CASES, exports: USE_CASES })
export class CatalogModule {}
