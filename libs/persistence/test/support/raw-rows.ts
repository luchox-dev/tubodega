// Minimal valid rows for the schema suites. Every builder returns something the
// database accepts, so each test changes exactly one field and violates exactly
// one constraint — otherwise a passing test proves nothing about which CHECK
// fired (spec 06 §5).
import { v7 } from 'uuid';
import type { OrgId } from '@app/common';
import type { KyselyUnitOfWork, TransactionContext } from '@app/persistence';
import type { NewMovement, NewStockBalance } from '@app/persistence';

export interface World {
  readonly orgId: OrgId;
  readonly userId: string;
  /** QUANTITY product: movements about it must carry batch_id NULL (I-8). */
  readonly productId: string;
  /** LOT product with one batch, for the other side of I-8. */
  readonly lotProductId: string;
  readonly batchId: string;
  readonly sourceNodeId: string;
  readonly binNodeId: string;
  readonly custodyNodeId: string;
  readonly terminalNodeId: string;
}

const slugOf = (id: string): string => id.slice(-12);

/**
 * Commits one organization with everything a movement needs to exist. Real
 * rows, not a rollback: the suites need concurrent transactions to see them.
 */
export async function seedWorld(
  uow: KyselyUnitOfWork,
  ctx: TransactionContext,
  label: string,
): Promise<World> {
  const w: World = {
    orgId: v7() as OrgId,
    userId: v7(),
    productId: v7(),
    lotProductId: v7(),
    batchId: v7(),
    sourceNodeId: v7(),
    binNodeId: v7(),
    custodyNodeId: v7(),
    terminalNodeId: v7(),
  };

  await uow.runAs({ pool: 'system' }, async () => {
    const db = ctx.current();
    await db
      .insertInto('organization')
      .values({ id: w.orgId, name: label, slug: `${label}-${slugOf(w.orgId)}` })
      .execute();
    await db
      .insertInto('appUser')
      .values({
        id: w.userId,
        orgId: w.orgId,
        email: `${label}-${slugOf(w.userId)}@raw.test`,
        passwordHash: 'h',
        name: label,
      })
      .execute();
    await db
      .insertInto('product')
      .values([
        {
          id: w.productId,
          orgId: w.orgId,
          sku: `QTY-${slugOf(w.productId)}`,
          name: 'Por cantidad',
          trackingMode: 'QUANTITY',
          uom: 'UNIT',
        },
        {
          id: w.lotProductId,
          orgId: w.orgId,
          sku: `LOT-${slugOf(w.lotProductId)}`,
          name: 'Por lote',
          trackingMode: 'LOT',
          uom: 'UNIT',
        },
      ])
      .execute();
    await db
      .insertInto('batch')
      .values({
        id: w.batchId,
        orgId: w.orgId,
        productId: w.lotProductId,
        lotCode: `L-${slugOf(w.batchId)}`,
      })
      .execute();
    await db
      .insertInto('node')
      .values([
        { id: w.sourceNodeId, orgId: w.orgId, kind: 'SOURCE', code: `SRC-${slugOf(w.sourceNodeId)}`, name: 'Proveedor', path: `SRC-${slugOf(w.sourceNodeId)}` },
        { id: w.binNodeId, orgId: w.orgId, kind: 'INTERNAL', code: `BIN-${slugOf(w.binNodeId)}`, name: 'Bin', path: `BIN-${slugOf(w.binNodeId)}` },
        { id: w.custodyNodeId, orgId: w.orgId, kind: 'CUSTODY', code: `CUS-${slugOf(w.custodyNodeId)}`, name: 'Juan', path: `CUS-${slugOf(w.custodyNodeId)}` },
        { id: w.terminalNodeId, orgId: w.orgId, kind: 'TERMINAL', code: `TRM-${slugOf(w.terminalNodeId)}`, name: 'Venta', path: `TRM-${slugOf(w.terminalNodeId)}` },
      ])
      .execute();
  });

  return w;
}

/** A movement that the database accepts: SOURCE → bin, one unit, by quantity. */
export function rawMovement(w: World, over: Partial<NewMovement> = {}): NewMovement {
  return {
    id: v7(),
    orgId: w.orgId,
    productId: w.productId,
    batchId: null,
    fromNodeId: w.sourceNodeId,
    toNodeId: w.binNodeId,
    quantity: '1.000',
    occurredAt: new Date(),
    actorId: w.userId,
    traceId: v7(),
    trackingMode: 'QUANTITY',
    fromNodeKind: 'SOURCE',
    toNodeKind: 'INTERNAL',
    ...over,
  };
}

/** A balance the database accepts: one unit of the QUANTITY product in the bin. */
export function rawBalance(w: World, over: Partial<NewStockBalance> = {}): NewStockBalance {
  return {
    id: v7(),
    orgId: w.orgId,
    nodeId: w.binNodeId,
    productId: w.productId,
    batchId: null,
    nodeKind: 'INTERNAL',
    quantity: '1.000',
    ...over,
  };
}

/**
 * Fills every remaining table with org_id, so the RLS suite can prove the
 * policy on all 19 of them. Returns nothing: the suites only need the rows to
 * exist under `w.orgId`.
 */
export async function seedEveryTable(
  uow: KyselyUnitOfWork,
  ctx: TransactionContext,
  w: World,
): Promise<void> {
  await uow.runAs({ pool: 'system' }, async () => {
    const db = ctx.current();
    const key = `k-${slugOf(v7())}`;
    await db.insertInto('userRole').values({ userId: w.userId, orgId: w.orgId, role: 'OWNER' }).execute();
    await db
      .insertInto('refreshToken')
      .values({ id: v7(), orgId: w.orgId, userId: w.userId, tokenHash: `t-${slugOf(v7())}`, expiresAt: new Date() })
      .execute();
    await db.insertInto('outboxEvent').values({ id: v7(), orgId: w.orgId, type: 'probe', payload: '{}', traceId: v7() }).execute();
    await db
      .insertInto('idempotencyKey')
      .values({ orgId: w.orgId, key, requestHash: 'h', status: 'COMPLETED', expiresAt: new Date(Date.now() + 8.64e7) })
      .execute();
    await db
      .insertInto('productCode')
      .values({ id: v7(), orgId: w.orgId, productId: w.productId, value: `C-${slugOf(v7())}`, kind: 'EAN' })
      .execute();
    await db
      .insertInto('productMedia')
      .values({ id: v7(), orgId: w.orgId, productId: w.productId, storageKey: `s/${v7()}`, contentType: 'image/png', byteSize: '10' })
      .execute();
    await db
      .insertInto('mediaUpload')
      .values({ id: v7(), orgId: w.orgId, storageKey: `u/${v7()}`, contentType: 'image/png', byteSize: '10', uploadedBy: w.userId })
      .execute();
    await db
      .insertInto('customFieldDefinition')
      .values({ id: v7(), orgId: w.orgId, entity: 'PRODUCT', key: 'proveedor', label: 'Proveedor', type: 'TEXT' })
      .execute();
    await db.insertInto('movement').values(rawMovement(w)).execute();
    await db.insertInto('stockBalance').values(rawBalance(w)).execute();

    const templateCode = `tpl-${slugOf(v7())}`;
    const instanceId = v7();
    await db
      .insertInto('processTemplate')
      .values({ id: v7(), orgId: w.orgId, code: templateCode, version: 1, steps: '[]' })
      .execute();
    await db
      .insertInto('processInstance')
      .values({
        id: instanceId,
        orgId: w.orgId,
        templateCode,
        templateVersion: 1,
        state: 'OPEN',
        actorId: w.userId,
      })
      .execute();
    await db
      .insertInto('stepCompletion')
      .values({ id: v7(), orgId: w.orgId, instanceId, stepId: 'paso-1', actorId: w.userId, payload: '{}' })
      .execute();
    await db
      .insertInto('alert')
      .values({ id: v7(), orgId: w.orgId, kind: 'BATCH_EXPIRING', subjectType: 'BATCH', subjectId: w.batchId, dueAt: new Date() })
      .execute();
    await db
      .insertInto('alertRule')
      .values({ orgId: w.orgId, kind: 'BATCH_EXPIRING', thresholdDays: 7 })
      .execute();
  });
}

/**
 * There is no cleanup helper on purpose. `movement` has UPDATE and DELETE
 * revoked for both application roles (I-3), and product, node and app_user are
 * pinned by its foreign keys: the immutable ledger makes a full teardown
 * impossible by design. The test database is never cleaned — every suite uses
 * a fresh random organization instead (test/support/e2e/tenant.ts says the
 * same about e2e).
 */
