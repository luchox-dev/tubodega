import { Module } from '@nestjs/common';
import { CreateNode } from './application/use-cases/nodes/create-node.js';
import { DeactivateNode } from './application/use-cases/nodes/deactivate-node.js';
import { GetNode } from './application/use-cases/nodes/get-node.js';
import { GetNodeTree } from './application/use-cases/nodes/get-node-tree.js';
import { ListNodes } from './application/use-cases/nodes/list-nodes.js';
import { MoveNode } from './application/use-cases/nodes/move-node.js';
import { UpdateNode } from './application/use-cases/nodes/update-node.js';
import { SeedBoundaryNodes } from './application/use-cases/seed-boundary-nodes.js';

/**
 * The node use cases. Repositories, clock, ids and the event publisher are
 * bound by the root application (spec 01 §6); they reach here through a global
 * module. The ledger half of this library arrives with wave 3.
 */
const USE_CASES = [
  CreateNode,
  UpdateNode,
  MoveNode,
  DeactivateNode,
  GetNode,
  ListNodes,
  GetNodeTree,
  SeedBoundaryNodes,
];

@Module({ providers: USE_CASES, exports: USE_CASES })
export class InventoryModule {}
