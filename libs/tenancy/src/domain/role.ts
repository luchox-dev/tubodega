export enum Role {
  OWNER = 'OWNER',
  ADMIN = 'ADMIN',
  OPERATOR = 'OPERATOR',
  VIEWER = 'VIEWER',
}

export enum Action {
  MANAGE_ORG = 'MANAGE_ORG',
  MANAGE_USERS = 'MANAGE_USERS',
  MANAGE_CATALOG = 'MANAGE_CATALOG',
  CREATE_BATCH = 'CREATE_BATCH',
  MANAGE_NODES = 'MANAGE_NODES',
  RECORD_MOVEMENT = 'RECORD_MOVEMENT',
  REVERSE_MOVEMENT = 'REVERSE_MOVEMENT',
  READ = 'READ',
}

/** The permission matrix of spec 10 §2. Fixed roles, not configurable permissions. */
export const PERMISSIONS: Readonly<Record<Role, ReadonlySet<Action>>> = {
  [Role.OWNER]: new Set(Object.values(Action)),
  [Role.ADMIN]: new Set([
    Action.MANAGE_USERS,
    Action.MANAGE_CATALOG,
    Action.CREATE_BATCH,
    Action.MANAGE_NODES,
    Action.RECORD_MOVEMENT,
    Action.REVERSE_MOVEMENT,
    Action.READ,
  ]),
  [Role.OPERATOR]: new Set([Action.CREATE_BATCH, Action.RECORD_MOVEMENT, Action.READ]),
  [Role.VIEWER]: new Set([Action.READ]),
};

export const canAny = (roles: Iterable<Role>, action: Action): boolean => {
  for (const role of roles) if (PERMISSIONS[role].has(action)) return true;
  return false;
};
