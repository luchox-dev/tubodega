import type { Cursor, OrgId, Page } from '@app/common';
import type { WhereInput } from './where.js';

/**
 * The DAO contract of spec 08 §4. Three layers, not one: a DAO of `movement`
 * that inherited `update` would have the method in its type and someone would
 * eventually call it. Append-only is a shape, not just a REVOKE (I-3).
 */
export type Cols<T> = readonly (keyof T & string)[];
export type OrderBy<T> = { [K in keyof T]?: 'asc' | 'desc' };

export interface FindArgs<T> {
  where?: WhereInput<T>;
  orderBy?: OrderBy<T>;
}
export interface FindManyArgs<T> extends FindArgs<T> {
  take?: number;
  skip?: number;
}
export interface FindPageArgs<T> {
  where?: WhereInput<T>;
  /** One column; the id columns are always the tie-break. */
  orderBy?: OrderBy<T>;
  take: number;
  cursor?: Cursor;
}
export interface SelectOpts<T, K extends keyof T & string> {
  select: readonly K[];
}
export interface UpdateOpts {
  expectedVersion?: number;
}

export interface IReadDao<E, T> {
  findUnique(id: E): Promise<T | null>;
  findUnique<K extends keyof T & string>(id: E, opts: SelectOpts<T, K>): Promise<Pick<T, K> | null>;
  findUniqueOrThrow(id: E): Promise<T>;
  findManyByIds(ids: readonly E[]): Promise<T[]>;
  findFirst(args?: FindArgs<T>): Promise<T | null>;
  findMany(args?: FindManyArgs<T>): Promise<T[]>;
  findPage(args: FindPageArgs<T>): Promise<Page<T>>;
  count(where?: WhereInput<T>): Promise<number>;
  exists(where?: WhereInput<T>): Promise<boolean>;
}

export interface IAppendDao<E, T, N> extends IReadDao<E, T> {
  create(data: N): Promise<T>;
  createMany(data: readonly N[]): Promise<T[]>;
}

export interface IBaseDao<E, T, N, P> extends IAppendDao<E, T, N> {
  update(id: E, data: P, opts?: UpdateOpts): Promise<T>;
  updateMany(where: WhereInput<T>, data: P): Promise<number>;
  upsert(id: E, create: N, update: P): Promise<T>;
  delete(id: E): Promise<T>;
  deleteMany(where: WhereInput<T>): Promise<number>;
}

/** The Org family: the same signatures with `orgId` first. See spec 08 §3. */
export interface IOrgReadDao<E, T> {
  findUnique(orgId: OrgId, id: E): Promise<T | null>;
  findUnique<K extends keyof T & string>(orgId: OrgId, id: E, opts: SelectOpts<T, K>): Promise<Pick<T, K> | null>;
  findUniqueOrThrow(orgId: OrgId, id: E): Promise<T>;
  findManyByIds(orgId: OrgId, ids: readonly E[]): Promise<T[]>;
  findFirst(orgId: OrgId, args?: FindArgs<T>): Promise<T | null>;
  findMany(orgId: OrgId, args?: FindManyArgs<T>): Promise<T[]>;
  findPage(orgId: OrgId, args: FindPageArgs<T>): Promise<Page<T>>;
  count(orgId: OrgId, where?: WhereInput<T>): Promise<number>;
  exists(orgId: OrgId, where?: WhereInput<T>): Promise<boolean>;
}
export interface IOrgAppendDao<E, T, N> extends IOrgReadDao<E, T> {
  create(data: N): Promise<T>;
  createMany(data: readonly N[]): Promise<T[]>;
}
export interface IOrgDao<E, T, N, P> extends IOrgAppendDao<E, T, N> {
  update(orgId: OrgId, id: E, data: P, opts?: UpdateOpts): Promise<T>;
  updateMany(orgId: OrgId, where: WhereInput<T>, data: P): Promise<number>;
  upsert(orgId: OrgId, id: E, create: N, update: P): Promise<T>;
  delete(orgId: OrgId, id: E): Promise<T>;
  deleteMany(orgId: OrgId, where: WhereInput<T>): Promise<number>;
}
