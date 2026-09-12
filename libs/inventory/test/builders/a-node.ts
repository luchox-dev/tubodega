import { v7 } from 'uuid';
import { unwrap, type OrgId } from '@app/common';
import { Node, NodeKind, type NodeId } from '@app/inventory';

export const ORG = '018f0000-0000-7000-8000-000000000001' as OrgId;

type Over = Partial<{ orgId: OrgId; kind: NodeKind; code: string; name: string }>;

/** A node with sensible defaults; pass the parent to hang it from something. */
export function aNode(over: Over = {}, parent?: Node): Node {
  const code = over.code ?? 'BOD-A';
  return unwrap(
    Node.create(
      {
        id: v7() as NodeId,
        orgId: over.orgId ?? ORG,
        kind: over.kind ?? NodeKind.INTERNAL,
        code,
        name: over.name ?? code,
      },
      parent,
    ),
  );
}
