/* eslint-disable @typescript-eslint/no-explicit-any */
import type { OrgId, Page } from '@app/common';
import type { DB } from '../../../generated/db.js';
import { TransactionContext, type Tx } from '../../../kysely/transaction.context.js';
import { AbstractBaseDao } from '../abstract-base.dao.js';
import type { Model } from '../abstract-read.dao.js';
import type { FindArgs, FindManyArgs, FindPageArgs, IOrgReadDao, SelectOpts } from '../interfaces.js';
import type { WhereInput } from '../where.js';

/**
 * The Org family (spec 08 §3). Almost every table carries `org_id`, and spec
 * 04 §4 requires the repository to filter by it *in addition to* RLS. The
 * family turns that requirement into a signature: there is no `findMany`
 * without `orgId`.
 *
 * It is built by **composition**, not inheritance: TypeScript does not allow a
 * subclass to add a parameter to an inherited method — the signature stops
 * being compatible — and composition avoids duplicating the CRUD, which then
 * exists exactly once, in the flat family.
 *
 * The consequence that matters: the Org generic cannot cross organizations.
 * Whatever needs to — the login that looks an email up everywhere, the outbox
 * dispatcher, the purges — is a concrete method on the closed list of spec
 * 07 §2, and writing it by hand is the moment someone asks whether it should
 * exist at all.
 */
export abstract class AbstractOrgReadDao<TB extends keyof DB & string, E>
  implements IOrgReadDao<E, Model<TB>>
{
  protected abstract readonly table: TB;
  /** Primary key columns, `org_id` excluded: it always arrives as a parameter. */
  protected readonly idColumns: readonly string[] = ['id'];
  protected readonly versioned: boolean = false;

  private wrapped?: AbstractBaseDao<TB, any>;

  constructor(protected readonly ctx: TransactionContext) {}

  /** The active transaction, for the concrete methods a table writes by hand. */
  protected get db(): Tx {
    return this.ctx.current();
  }
  protected get anyDb(): any {
    return this.ctx.current();
  }

  /**
   * The wrapped flat DAO, whose key is `E & { orgId }`. Built lazily because a
   * subclass initialises `table` after this constructor has run.
   */
  protected get flat(): AbstractBaseDao<TB, any> {
    const outer = this;
    this.wrapped ??= new (class extends AbstractBaseDao<TB, any> {
      protected readonly table = outer.table;
      protected override readonly idColumns = ['orgId', ...outer.idColumns];
      // The conflict target is the real primary key, which does not include org_id.
      protected override get conflictColumns(): readonly string[] {
        return outer.idColumns;
      }
      protected override readonly versioned = outer.versioned;
    })(this.ctx);
    return this.wrapped;
  }

  /** `E` is the id value for a single column, an object for a composite key. */
  protected key(orgId: OrgId, id: E): Record<string, unknown> {
    const own =
      this.idColumns.length === 1 && (typeof id !== 'object' || id === null)
        ? { [this.idColumns[0]!]: id }
        : (id as Record<string, unknown>);
    return { orgId, ...own };
  }

  /** Both filters at once: the explicit org_id and, underneath, RLS. */
  protected scoped(orgId: OrgId, where?: WhereInput<Model<TB>>): WhereInput<Model<TB>> {
    return (where === undefined ? { orgId } : { orgId, AND: [where] }) as unknown as WhereInput<Model<TB>>;
  }

  async findUnique(orgId: OrgId, id: E): Promise<Model<TB> | null>;
  async findUnique<K extends keyof Model<TB> & string>(
    orgId: OrgId,
    id: E,
    opts: SelectOpts<Model<TB>, K>,
  ): Promise<Pick<Model<TB>, K> | null>;
  async findUnique(orgId: OrgId, id: E, opts?: SelectOpts<Model<TB>, any>): Promise<any> {
    return opts ? this.flat.findUnique(this.key(orgId, id), opts) : this.flat.findUnique(this.key(orgId, id));
  }

  findUniqueOrThrow(orgId: OrgId, id: E): Promise<Model<TB>> {
    return this.flat.findUniqueOrThrow(this.key(orgId, id));
  }

  findManyByIds(orgId: OrgId, ids: readonly E[]): Promise<Model<TB>[]> {
    return this.flat.findManyByIds(ids.map((id) => this.key(orgId, id)));
  }

  findFirst(orgId: OrgId, args: FindArgs<Model<TB>> = {}): Promise<Model<TB> | null> {
    return this.flat.findFirst({ ...args, where: this.scoped(orgId, args.where) });
  }

  findMany(orgId: OrgId, args: FindManyArgs<Model<TB>> = {}): Promise<Model<TB>[]> {
    return this.flat.findMany({ ...args, where: this.scoped(orgId, args.where) });
  }

  findPage(orgId: OrgId, args: FindPageArgs<Model<TB>>): Promise<Page<Model<TB>>> {
    return this.flat.findPage({ ...args, where: this.scoped(orgId, args.where) });
  }

  count(orgId: OrgId, where?: WhereInput<Model<TB>>): Promise<number> {
    return this.flat.count(this.scoped(orgId, where));
  }

  exists(orgId: OrgId, where?: WhereInput<Model<TB>>): Promise<boolean> {
    return this.flat.exists(this.scoped(orgId, where));
  }
}
