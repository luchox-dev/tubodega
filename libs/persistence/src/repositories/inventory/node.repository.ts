import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, type OrgId, type Page, type UnitOfWork } from '@app/common';
import {
  NodeCodeTakenError,
  type Node, type NodeCode, type NodeFilter, type NodeId, type NodePage,
  type NodePath, type NodeRepository,
} from '@app/inventory';
import { NodeDao } from '../../dao/node.dao.js';
import { RecordNotFoundError, UniqueViolationError } from '../../dao/base/errors.js';
import { nodeValues, toNode } from './mapping.js';

const translate = (code: string) => (e: unknown): never => {
  if (e instanceof UniqueViolationError && e.constraint === 'node_org_id_code_key') {
    throw new NodeCodeTakenError(code);
  }
  // The 23503 on node_org_id_parent_id_fkey and the 23514 on
  // node_i10_parent_is_internal are deliberately NOT translated: the use case
  // already checked both, so one reaching here means the domain let something
  // through, and a 500 with a stack says more than a fabricated 422.
  throw e;
};

@Injectable()
export class KyselyNodeRepository implements NodeRepository {
  constructor(
    private readonly dao: NodeDao,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async findById(orgId: OrgId, id: NodeId): Promise<Node | null> {
    const row = await this.dao.findUnique(orgId, id);
    return row ? toNode(row) : null;
  }

  async findByCode(orgId: OrgId, code: NodeCode): Promise<Node | null> {
    const row = await this.dao.findFirst(orgId, { where: { code } });
    return row ? toNode(row) : null;
  }

  async findManyByIds(orgId: OrgId, ids: readonly NodeId[]): Promise<Map<string, Node>> {
    if (ids.length === 0) return new Map();
    const rows = await this.dao.findMany(orgId, { where: { id: { in: [...ids] } } });
    return new Map(rows.map((r) => [r.id, toNode(r)]));
  }

  async listUnder(orgId: OrgId, path: NodePath, limit: number): Promise<Node[]> {
    return (await this.dao.listUnder(orgId, path, limit)).map(toNode);
  }

  async listActiveChildren(orgId: OrgId, path: NodePath, limit: number): Promise<Node[]> {
    return (await this.dao.listUnder(orgId, path, limit, true)).map(toNode);
  }

  async list(orgId: OrgId, filter: NodeFilter, page: NodePage): Promise<Page<Node>> {
    const found = await this.dao.findPage(orgId, {
      take: page.limit,
      ...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
      orderBy: { [page.sort.field]: page.sort.dir },
      where: {
        ...(filter.kind !== undefined ? { kind: filter.kind } : {}),
        ...(filter.active !== undefined ? { active: filter.active } : {}),
        // startsWith compiles to LIKE escapeLike(v) || '%'. The trailing
        // separator is the same one isDescendantOf and updateSubtreePaths use:
        // one rule, three call sites, so 'BOD-A/Z10' can never leak in.
        ...(filter.underPath !== undefined ? { path: { startsWith: `${filter.underPath}/` } } : {}),
      },
    });
    return { ...found, data: found.data.map(toNode) };
  }

  /**
   * Update first, insert if it was not there: the same shape as every other
   * repository of the house, and the only place the version is bumped.
   *
   * Both writes sit in a savepoint. A 23505 on (org_id, code) aborts the
   * transaction, and the seeder — and tomorrow a node import — has to be able
   * to carry on with the next code, which is impossible inside an aborted
   * transaction (deviation 5 of plan 3).
   */
  async save(node: Node, expectedVersion?: number): Promise<number> {
    const data = nodeValues(node);
    try {
      const row = await this.uow.run(() =>
        this.dao.update(
          node.orgId,
          node.id,
          data,
          expectedVersion !== undefined ? { expectedVersion } : {},
        ),
      );
      return row.version;
    } catch (e) {
      if (e instanceof RecordNotFoundError) {
        const row = await this.uow
          .run(() => this.dao.create({ id: node.id, orgId: node.orgId, ...data }))
          .catch(translate(node.code));
        return row.version;
      }
      return translate(node.code)(e);
    }
  }

  async updateSubtreePaths(orgId: OrgId, oldPrefix: NodePath, newPrefix: NodePath): Promise<void> {
    await this.dao.updateSubtreePaths(orgId, oldPrefix, newPrefix);
  }
}
