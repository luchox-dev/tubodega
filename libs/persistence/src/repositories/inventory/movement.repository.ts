import { Injectable } from '@nestjs/common';
import type { OrgId, Page } from '@app/common';
import type { ProductId } from '@app/catalog';
import {
  AlreadyReversedError, MovementIdTakenError, Quantity,
  type Movement, type MovementFilter, type MovementId, type MovementPage,
  type MovementRepository, type OpenCustodyFilter, type OpenCustodyRow,
} from '@app/inventory';
import { MovementDao } from '../../dao/movement.dao.js';
import { UniqueViolationError } from '../../dao/base/errors.js';
import { movementValues, toMovement } from './mapping.js';

const translate = (e: unknown): never => {
  if (e instanceof UniqueViolationError) {
    // The client's UUIDv7 is the primary key, so a retry that slipped past the
    // idempotency table lands here — the last line of I-7 (decision D-10).
    if (e.constraint === 'movement_pkey') throw new MovementIdTakenError('repetido');
    // I-13, the partial UNIQUE (org_id, reverses_id).
    if (e.constraint === 'movement_org_id_reverses_id_key') throw new AlreadyReversedError('el original');
  }
  // The 23503 of the composite FKs and the 23514 of the seven CHECKs are
  // deliberately NOT translated: the use case already checked all of them, so
  // one reaching here means the domain let something through, and a 500 with a
  // stack says more than a fabricated 422.
  throw e;
};

/**
 * The ledger, written. **No update, no delete** — not in the port, not here,
 * and revoked in the database role (spec 04 §3.4). Three layers of I-3.
 */
@Injectable()
export class KyselyMovementRepository implements MovementRepository {
  constructor(private readonly dao: MovementDao) {}

  async findById(orgId: OrgId, id: MovementId): Promise<Movement | null> {
    const row = await this.dao.findUnique(orgId, id);
    return row ? toMovement(row) : null;
  }

  existsReversalOf(orgId: OrgId, id: MovementId): Promise<boolean> {
    return this.dao.existsReversalOf(orgId, id);
  }

  async settledQuantity(orgId: OrgId, checkOutId: MovementId): Promise<Quantity> {
    return Quantity.rehydrate(await this.dao.settledQuantity(orgId, checkOutId));
  }

  async listOpenCustodies(
    orgId: OrgId, filter: OpenCustodyFilter, page: MovementPage,
  ): Promise<Page<OpenCustodyRow>> {
    const { rows, hasMore } = await this.dao.openCustodies(
      orgId,
      {
        ...(filter.nodeId !== undefined ? { nodeId: filter.nodeId } : {}),
        ...(filter.overdueBefore !== undefined ? { overdueBefore: filter.overdueBefore } : {}),
      },
      { limit: page.limit, dir: page.sort.dir, ...(page.cursor !== undefined ? { cursor: page.cursor } : {}) },
    );
    const last = rows[rows.length - 1];
    return {
      data: rows.map((r) => ({ checkOut: toMovement(r), pending: Quantity.rehydrate(r.pending) })),
      hasMore,
      ...(hasMore && last ? { nextCursor: MovementDao.custodyCursor(last) } : {}),
    };
  }

  countByProduct(orgId: OrgId, productId: ProductId): Promise<number> {
    return this.dao.countByProduct(orgId, productId);
  }

  async list(orgId: OrgId, filter: MovementFilter, page: MovementPage): Promise<Page<Movement>> {
    const found = await this.dao.findPage(orgId, {
      take: page.limit,
      ...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
      orderBy: { occurredAt: page.sort.dir },
      where: {
        ...(filter.productId !== undefined ? { productId: filter.productId } : {}),
        ...(filter.batchId !== undefined ? { batchId: filter.batchId } : {}),
        ...(filter.actorId !== undefined ? { actorId: filter.actorId } : {}),
        ...(filter.from !== undefined || filter.to !== undefined
          ? {
              occurredAt: {
                ...(filter.from !== undefined ? { gte: filter.from } : {}),
                ...(filter.to !== undefined ? { lte: filter.to } : {}),
              },
            }
          : {}),
        // Either end: "everything that touched this shelf" is the question
        // somebody reconciling a location actually asks.
        ...(filter.nodeId !== undefined
          ? { OR: [{ fromNodeId: filter.nodeId }, { toNodeId: filter.nodeId }] }
          : {}),
      },
    });
    return { ...found, data: found.data.map(toMovement) };
  }

  async append(movement: Movement): Promise<void> {
    await this.dao.create(movementValues(movement)).catch(translate);
  }

  async appendMany(movements: readonly Movement[]): Promise<void> {
    if (movements.length === 0) return;
    await this.dao.createMany(movements.map(movementValues)).catch(translate);
  }
}
