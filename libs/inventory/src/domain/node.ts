import { ok, type OrgId, type Result } from '@app/common';
import { CustomFieldValues, type CustomFieldDefinition } from '@app/catalog';
import { NodeCode, NodePath, type NodeId } from './ids.js';

/** Spec 02 §3. INTERNAL and CUSTODY are custodial; SOURCE and TERMINAL are the
 *  boundaries of the system, and their balance is a running total. */
export enum NodeKind {
  INTERNAL = 'INTERNAL',
  CUSTODY = 'CUSTODY',
  TERMINAL = 'TERMINAL',
  SOURCE = 'SOURCE',
}

export const NODE_KINDS = Object.values(NodeKind);

export interface CreateNodeProps {
  readonly id: NodeId;
  readonly orgId: OrgId;
  readonly kind: NodeKind;
  readonly code: string;
  readonly name: string;
  readonly customFields?: Readonly<Record<string, unknown>>;
}

export interface UpdateNodeProps {
  readonly name?: string;
  readonly customFields?: Readonly<Record<string, unknown>>;
}

/** A place. The tree is materialised in `path` (spec 12 §2). */
export class Node {
  private constructor(
    readonly id: NodeId,
    readonly orgId: OrgId,
    readonly kind: NodeKind,
    readonly code: NodeCode,
    readonly name: string,
    readonly parentId: NodeId | undefined,
    readonly path: NodePath,
    readonly active: boolean,
    readonly customFields: CustomFieldValues,
    readonly version: number,
  ) {}

  /** The parent arrives resolved, not as an id: the path is built from its path,
   *  and I-10 is decided by its kind. */
  static create(
    input: CreateNodeProps,
    parent?: Node,
    defs: readonly CustomFieldDefinition[] = [],
  ): Result<Node> {
    const code = NodeCode.of(input.code);
    if (!code.ok) return code;
    const custom = CustomFieldValues.build(defs, input.customFields ?? {});
    if (!custom.ok) return custom;

    return ok(
      new Node(
        input.id,
        input.orgId,
        input.kind,
        code.value,
        input.name.trim(),
        parent?.id,
        NodePath.of(parent?.path, code.value),
        true,
        custom.value,
        1,
      ),
    );
  }

  static rehydrate(p: {
    id: NodeId;
    orgId: OrgId;
    kind: NodeKind;
    code: NodeCode;
    name: string;
    parentId?: NodeId;
    path: NodePath;
    active: boolean;
    customFields: CustomFieldValues;
    version: number;
  }): Node {
    return new Node(
      p.id, p.orgId, p.kind, p.code, p.name, p.parentId, p.path, p.active, p.customFields, p.version,
    );
  }

  /** The central predicate of the module: what the business owns, and whose
   *  balance therefore cannot go negative (I-4, I-9). */
  isCustodial(): boolean {
    return this.kind === NodeKind.INTERNAL || this.kind === NodeKind.CUSTODY;
  }

  isBoundary(): boolean {
    return !this.isCustodial();
  }

  /** I-16. The history keeps its movements; the new ones do not happen. */
  canReceiveMovements(): boolean {
    return this.active;
  }

  /**
   * Strict, and by prefix *including the separator*: 'BOD-A/Z1' is a prefix of
   * 'BOD-A/Z10' and is not its ancestor. No recursion — the path already holds
   * the whole chain (spec 12 §4.1).
   */
  isDescendantOf(other: Node): boolean {
    return this.orgId === other.orgId && this.path.startsWith(NodePath.descendantPrefix(other.path));
  }

  update(patch: UpdateNodeProps, defs: readonly CustomFieldDefinition[] = []): Result<Node> {
    const custom =
      patch.customFields === undefined
        ? ok(this.customFields)
        : CustomFieldValues.build(defs, patch.customFields);
    if (!custom.ok) return custom;

    return ok(
      new Node(
        this.id, this.orgId, this.kind, this.code,
        patch.name?.trim() ?? this.name,
        this.parentId, this.path, this.active, custom.value, this.version,
      ),
    );
  }

  /**
   * A new place for the same node: parent and path change, `code` and `kind` do
   * not. The kind is denormalised into movement.to_node_kind, so changing it
   * would desynchronise the history — the same reasoning that locks I-15; and
   * the code is the path segment, which is what `move` exists to rearrange
   * explicitly (decision D-25).
   */
  moveTo(parent: Node | undefined): Node {
    return new Node(
      this.id, this.orgId, this.kind, this.code, this.name,
      parent?.id,
      NodePath.of(parent?.path, this.code),
      this.active, this.customFields, this.version,
    );
  }

  deactivate(): Node {
    return new Node(
      this.id, this.orgId, this.kind, this.code, this.name,
      this.parentId, this.path, false, this.customFields, this.version,
    );
  }
}
