import { Action, PERMISSIONS, Role, canAny } from './role.js';

// The matrix of spec 10 §2, transcribed. ● = allowed.
const MATRIX: Record<Action, Record<Role, boolean>> = {
  [Action.MANAGE_ORG]: { OWNER: true, ADMIN: false, OPERATOR: false, VIEWER: false },
  [Action.MANAGE_USERS]: { OWNER: true, ADMIN: true, OPERATOR: false, VIEWER: false },
  [Action.MANAGE_CATALOG]: { OWNER: true, ADMIN: true, OPERATOR: false, VIEWER: false },
  [Action.CREATE_BATCH]: { OWNER: true, ADMIN: true, OPERATOR: true, VIEWER: false },
  [Action.MANAGE_NODES]: { OWNER: true, ADMIN: true, OPERATOR: false, VIEWER: false },
  [Action.RECORD_MOVEMENT]: { OWNER: true, ADMIN: true, OPERATOR: true, VIEWER: false },
  [Action.REVERSE_MOVEMENT]: { OWNER: true, ADMIN: true, OPERATOR: false, VIEWER: false },
  [Action.READ]: { OWNER: true, ADMIN: true, OPERATOR: true, VIEWER: true },
};

const cases = Object.values(Action).flatMap((action) =>
  Object.values(Role).map((role) => [action, role, MATRIX[action][role]] as const),
);

describe('PERMISSIONS matrix (spec 10 §2)', () => {
  it.each(cases)('%s × %s → %s', (action, role, allowed) => {
    expect(PERMISSIONS[role].has(action)).toBe(allowed);
  });

  it('canAny is true if any role grants the action', () => {
    expect(canAny([Role.VIEWER, Role.OPERATOR], Action.RECORD_MOVEMENT)).toBe(true);
    expect(canAny([Role.VIEWER], Action.RECORD_MOVEMENT)).toBe(false);
    expect(canAny([], Action.READ)).toBe(false);
  });
});
