import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, type OrgId, type UnitOfWork } from '@app/common';
import {
  LotCodeTakenError, SerialTakenError,
  type Batch, type BatchId, type BatchRepository, type ProductId,
} from '@app/catalog';
import { BatchDao } from '../../dao/batch.dao.js';
import { UniqueViolationError } from '../../dao/base/errors.js';
import { toBatch } from './mapping.js';

@Injectable()
export class KyselyBatchRepository implements BatchRepository {
  constructor(
    private readonly dao: BatchDao,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async findById(orgId: OrgId, id: BatchId): Promise<Batch | null> {
    const row = await this.dao.findUnique(orgId, id);
    return row ? toBatch(row) : null;
  }

  async findBySerial(orgId: OrgId, serial: string): Promise<Batch | null> {
    const row = await this.dao.findFirst(orgId, { where: { serial } });
    return row ? toBatch(row) : null;
  }

  async findByLotCode(orgId: OrgId, productId: ProductId, lotCode: string): Promise<Batch | null> {
    const row = await this.dao.findFirst(orgId, { where: { productId, lotCode } });
    return row ? toBatch(row) : null;
  }

  async listByProduct(orgId: OrgId, productId: ProductId): Promise<Batch[]> {
    const rows = await this.dao.findMany(orgId, {
      where: { productId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toBatch);
  }

  async listExpiringBefore(orgId: OrgId, date: Date): Promise<Batch[]> {
    const rows = await this.dao.findMany(orgId, { where: { expiresAt: { lte: date } } });
    return rows.map(toBatch);
  }

  /** C-5 and C-6 are the two partial unique indexes; each has its own error so
   *  the user learns whether the clash is the serial or the lot. In a savepoint
   *  for the same reason as everywhere else: a 23505 aborts the transaction and
   *  the caller has to survive it (D-9). */
  async save(batch: Batch): Promise<void> {
    try {
      await this.uow.run(() =>
        this.dao.create({
          id: batch.id,
          orgId: batch.orgId,
          productId: batch.productId,
          lotCode: batch.lotCode ?? null,
          serial: batch.serial ?? null,
          expiresAt: batch.expiresAt ?? null,
          customFields: JSON.stringify(batch.customFields.toJSON()),
        }),
      );
    } catch (e) {
      if (e instanceof UniqueViolationError) {
        if (e.constraint === 'batch_org_id_serial_key') throw new SerialTakenError(batch.serial!);
        if (e.constraint === 'batch_org_id_product_id_lot_code_key') {
          throw new LotCodeTakenError(batch.lotCode!);
        }
      }
      throw e;
    }
  }
}
