/**
 * The four invariants of spec 06 §7, asked of the database directly.
 *
 * Every check returns **the rows that violate it** — empty means the invariant
 * stands. A boolean would only ever say `false !== true`; a row says which
 * position drifted, and by how much.
 *
 * The comparisons live in SQL on purpose. `numeric` comes back as a string and
 * `sum()` changes its scale, so `'0'` and `'0.000'` are the same number and two
 * different strings: comparing them in TypeScript would invent failures and,
 * worse, hide real ones.
 */
import { sql } from 'kysely';
import type { OrgId } from '@app/common';
import type { Tx } from '@app/persistence';

export interface LedgerMismatch {
  readonly nodeId: string;
  readonly productId: string;
  readonly batchId: string | null;
  readonly ledger: string;
  readonly materialized: string;
}

/**
 * I-5 · The materialised balance is a cache of the ledger, and a cache that
 * drifts from the fact it summarises is worse than no cache: dispatch, alerts
 * and the month-end read `stock_balance` and nobody adds the history up again.
 */
export async function ledgerMismatches(tx: Tx, orgId: OrgId): Promise<LedgerMismatch[]> {
  const { rows } = await sql<LedgerMismatch>`
    with entry as (
      select from_node_id as node_id, product_id, batch_id, -quantity as q
        from movement where org_id = ${orgId}
      union all
      select to_node_id as node_id, product_id, batch_id, quantity as q
        from movement where org_id = ${orgId}
    ),
    ledger as (
      select node_id, product_id, batch_id, sum(q) as q
        from entry group by node_id, product_id, batch_id
    ),
    balance as (
      select node_id, product_id, batch_id, quantity
        from stock_balance where org_id = ${orgId}
    )
    select
      coalesce(l.node_id, b.node_id)       as node_id,
      coalesce(l.product_id, b.product_id) as product_id,
      coalesce(l.batch_id, b.batch_id)     as batch_id,
      coalesce(l.q, 0)::text               as ledger,
      coalesce(b.quantity, 0)::text        as materialized
    from ledger l
    -- FULL OUTER and not INNER: a balance with no history behind it is exactly
    -- as wrong as a history that never reached the balance.
    full outer join balance b
      on b.node_id = l.node_id
     and b.product_id = l.product_id
     -- IS NOT DISTINCT FROM, because the null batch of a by-quantity product is
     -- the commonest row in any catalogue, and plain equality drops every one.
     and b.batch_id is not distinct from l.batch_id
    where coalesce(l.q, 0) <> coalesce(b.quantity, 0)
  `.execute(tx);
  return rows;
}

export interface ConservationBreach {
  readonly productId: string;
  readonly batchId: string | null;
  readonly outTerminal: string;
  readonly own: string;
  readonly inSource: string;
  readonly net: string;
}

/**
 * Conservation · What left through TERMINAL nodes, plus what is on our own
 * shelves, minus what came in through SOURCE nodes, is always zero. Nothing is
 * created and nothing is destroyed; it only changes place. The three terms are
 * selected separately so a failure shows which one is off.
 */
export async function conservationBreaches(tx: Tx, orgId: OrgId): Promise<ConservationBreach[]> {
  const { rows } = await sql<ConservationBreach>`
    select product_id, batch_id,
      coalesce(sum(quantity) filter (where node_kind = 'TERMINAL'), 0)::text              as out_terminal,
      coalesce(sum(quantity) filter (where node_kind in ('INTERNAL','CUSTODY')), 0)::text as own,
      coalesce(sum(-quantity) filter (where node_kind = 'SOURCE'), 0)::text               as in_source,
      coalesce(sum(quantity), 0)::text                                                    as net
    from stock_balance
    where org_id = ${orgId}
    group by product_id, batch_id
    having coalesce(sum(quantity), 0) <> 0
  `.execute(tx);
  return rows;
}

export interface SerialInTwoPlaces {
  readonly productId: string;
  readonly batchId: string | null;
  readonly nodes: string;
  readonly paths: string;
  readonly total: string;
}

/**
 * I-9 · A serial is one physical object, so it cannot be on two shelves at once.
 * `string_agg` of the paths is there so the counterexample names both places
 * rather than printing two uuids.
 */
export async function serialsInTwoPlaces(tx: Tx, orgId: OrgId): Promise<SerialInTwoPlaces[]> {
  const { rows } = await sql<SerialInTwoPlaces>`
    select s.product_id, s.batch_id,
           count(*)::text                            as nodes,
           string_agg(n.path, ', ' order by n.path)   as paths,
           sum(s.quantity)::text                      as total
    from stock_balance s
    join product p on p.org_id = s.org_id and p.id = s.product_id
    join node    n on n.org_id = s.org_id and n.id = s.node_id
    where s.org_id = ${orgId}
      and p.tracking_mode = 'SERIAL'
      and s.node_kind in ('INTERNAL','CUSTODY')
      and s.quantity <> 0
    group by s.product_id, s.batch_id
    having count(*) > 1
  `.execute(tx);
  return rows;
}

export interface CustodyPendingBreach {
  readonly id: string;
  readonly quantity: string;
  readonly pending: string;
}

/**
 * I-18 · The pending amount of every check-out stays between zero and what was
 * lent, after any sequence of partial check-ins and compensations. A reversed
 * check-in stops counting and the loan goes back up: the goods never really came
 * back. This mirrors the join `MovementDao.openCustodies` uses, minus its
 * `pending > 0` filter — that one is a listing rule, not the invariant.
 */
export async function custodyPendingBreaches(tx: Tx, orgId: OrgId): Promise<CustodyPendingBreach[]> {
  const { rows } = await sql<CustodyPendingBreach>`
    select c.id, c.quantity::text as quantity,
           (c.quantity - coalesce(sum(s.quantity), 0))::text as pending
    from movement c
    left join movement s
      on s.org_id = c.org_id and s.settles_id = c.id
     and not exists (
           select 1 from movement r
           where r.org_id = s.org_id and r.reverses_id = s.id)
    where c.org_id = ${orgId}
      and c.to_node_kind = 'CUSTODY'
      and c.settles_id is null
      and c.reverses_id is null
    group by c.id, c.quantity
    having (c.quantity - coalesce(sum(s.quantity), 0)) < 0
        or (c.quantity - coalesce(sum(s.quantity), 0)) > c.quantity
  `.execute(tx);
  return rows;
}

/**
 * Every check-out with what the ledger says is still out. The properties use it
 * to cross-check `MovementRepository.settledQuantity` — the method that decides
 * `settles-exceeded` in production — against the same arithmetic done in SQL.
 * If the two ever drift apart, the invariant would hold and the product would
 * still be wrong.
 */
export async function custodyPending(tx: Tx, orgId: OrgId): Promise<CustodyPendingBreach[]> {
  const { rows } = await sql<CustodyPendingBreach>`
    select c.id, c.quantity::text as quantity,
           (c.quantity - coalesce(sum(s.quantity), 0))::text as pending
    from movement c
    left join movement s
      on s.org_id = c.org_id and s.settles_id = c.id
     and not exists (
           select 1 from movement r
           where r.org_id = s.org_id and r.reverses_id = s.id)
    where c.org_id = ${orgId}
      and c.to_node_kind = 'CUSTODY'
      and c.settles_id is null
      and c.reverses_id is null
    group by c.id, c.quantity
  `.execute(tx);
  return rows;
}

export interface SerialCustodialTotal {
  readonly batchId: string;
  readonly total: string;
}

/** What sits in custodial nodes for each SERIAL batch, straight from the balances. */
export async function serialCustodialTotals(tx: Tx, orgId: OrgId): Promise<SerialCustodialTotal[]> {
  const { rows } = await sql<SerialCustodialTotal>`
    select s.batch_id, sum(s.quantity)::text as total
    from stock_balance s
    join product p on p.org_id = s.org_id and p.id = s.product_id
    where s.org_id = ${orgId}
      and p.tracking_mode = 'SERIAL'
      and s.node_kind in ('INTERNAL','CUSTODY')
      and s.batch_id is not null
    group by s.batch_id
  `.execute(tx);
  return rows;
}
