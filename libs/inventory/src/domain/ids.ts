import { err, ok, type Branded, type Result } from '@app/common';
import { InvalidNodeCodeError } from './errors.js';

export type NodeId = Branded<string, 'NodeId'>;
export type MovementId = Branded<string, 'MovementId'>;

/** Unique per organization, 1-64 characters (spec 12 §2). */
export type NodeCode = Branded<string, 'NodeCode'>;
/** Materialised chain of codes: "BOD-A/Z1/E3/B2". */
export type NodePath = Branded<string, 'NodePath'>;

/** The separator of a path, and therefore the one character a code cannot hold. */
const SEPARATOR = '/';

// No slash (it is the separator), no leading or trailing blank, 1-64 long.
// Allowing a slash would let a user forge an ancestry the chain of parents
// does not back: the path is derived, but it is also what queries trust.
const NODE_CODE_RE = /^[^/\s](?:[^/\n\r]{0,62}[^/\s])?$/;

export const NodeCode = {
  of(raw: string): Result<NodeCode, InvalidNodeCodeError> {
    const value = raw.trim();
    return NODE_CODE_RE.test(value) ? ok(value as NodeCode) : err(new InvalidNodeCodeError(raw));
  },
};

export const NodePath = {
  /** A root's path is its own code; a child's hangs from its parent. */
  of(parent: NodePath | undefined, code: NodeCode): NodePath {
    return (parent === undefined ? code : `${parent}${SEPARATOR}${code}`) as NodePath;
  },

  /**
   * The prefix every strict descendant starts with. The trailing separator is
   * the whole point: 'BOD-A/Z1' is a prefix of 'BOD-A/Z10', which is *not* its
   * descendant. Domain, `listUnder` and `updateSubtreePaths` all go through
   * here, so the three of them cannot drift apart.
   */
  descendantPrefix(path: NodePath): string {
    return `${path}${SEPARATOR}`;
  },
};
