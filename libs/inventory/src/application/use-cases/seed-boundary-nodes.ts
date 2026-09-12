import { Inject, Injectable } from '@nestjs/common';
import { ID_GENERATOR, unwrap, type IdGenerator, type OrgId } from '@app/common';
import { NodeCode, type NodeId } from '../../domain/ids.js';
import { Node, NodeKind } from '../../domain/node.js';
import { NODE_REPOSITORY, type NodeRepository } from '../ports/node.repository.js';

/**
 * The eight boundary nodes of spec 04 §6. Without them double entry has nothing
 * to post against, so they are part of what "an organization exists" means —
 * not something that later happens to it.
 */
export const BOUNDARY_NODES = [
  { kind: NodeKind.SOURCE, code: 'supplier-default', name: 'Proveedor sin especificar' },
  { kind: NodeKind.SOURCE, code: 'adjustment-in', name: 'Ajuste positivo' },
  { kind: NodeKind.SOURCE, code: 'opening-balance', name: 'Saldo inicial' },
  { kind: NodeKind.TERMINAL, code: 'sale', name: 'Venta' },
  { kind: NodeKind.TERMINAL, code: 'consumption', name: 'Consumo interno' },
  { kind: NodeKind.TERMINAL, code: 'shrinkage', name: 'Merma' },
  { kind: NodeKind.TERMINAL, code: 'adjustment-out', name: 'Ajuste negativo' },
  { kind: NodeKind.TERMINAL, code: 'supplier-return', name: 'Devolución a proveedor' },
] as const;

@Injectable()
export class SeedBoundaryNodes {
  constructor(
    @Inject(NODE_REPOSITORY) private readonly nodes: NodeRepository,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  /**
   * No ctx and no requireAction: this runs in system context, called by
   * CreateOrganization inside the transaction that creates the organization,
   * when there is no token and no user to authorize (spec 07 §2, decision
   * D-26). Taking an OrgId rather than a RequestContext is what keeps it off a
   * controller — every other use case of the house starts with one.
   *
   * It publishes nothing, either: organization.created already tells the story,
   * and nobody "created" these eight.
   *
   * Idempotent by code, and by reading first rather than leaning on ON CONFLICT:
   * a 23505 would abort the organization-creation transaction, which is exactly
   * what the idempotency is here to avoid.
   */
  async execute(orgId: OrgId): Promise<void> {
    for (const row of BOUNDARY_NODES) {
      const code = unwrap(NodeCode.of(row.code));
      if (await this.nodes.findByCode(orgId, code)) continue;
      await this.nodes.save(
        unwrap(
          Node.create({
            id: this.ids.next() as NodeId,
            orgId,
            kind: row.kind,
            code: row.code,
            name: row.name,
          }),
        ),
      );
    }
  }
}
