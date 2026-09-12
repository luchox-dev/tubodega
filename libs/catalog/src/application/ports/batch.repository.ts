import type { OrgId } from '@app/common';
import type { Batch } from '../../domain/batch.js';
import type { BatchId, ProductId } from '../../domain/ids.js';

export interface BatchRepository {
  findById(orgId: OrgId, id: BatchId): Promise<Batch | null>;
  /** Unique per organization (C-5), which is why a scan can resolve it. */
  findBySerial(orgId: OrgId, serial: string): Promise<Batch | null>;
  /** Unique per product (C-6), which is why a scan cannot. */
  findByLotCode(orgId: OrgId, productId: ProductId, lotCode: string): Promise<Batch | null>;
  listByProduct(orgId: OrgId, productId: ProductId): Promise<Batch[]>;
  /** Used by the alert sweep of wave 5. */
  listExpiringBefore(orgId: OrgId, date: Date): Promise<Batch[]>;
  save(batch: Batch): Promise<void>;
}

export const BATCH_REPOSITORY = Symbol('BatchRepository');
