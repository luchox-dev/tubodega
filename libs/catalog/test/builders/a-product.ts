import { v7 } from 'uuid';
import { unwrap } from '@app/common';
import { Product, TrackingMode, type ProductId } from '@app/catalog';
import { ORG } from './a-custom-field.js';

export function aProduct(
  over: Partial<Parameters<typeof Product.create>[0]> = {},
  defs: Parameters<typeof Product.create>[1] = [],
) {
  return unwrap(
    Product.create(
      {
        id: v7() as ProductId,
        orgId: ORG,
        sku: 'TOR-M8',
        name: 'Tornillo M8',
        trackingMode: TrackingMode.QUANTITY,
        uom: 'UNIT',
        ...over,
      },
      defs,
    ),
  );
}
