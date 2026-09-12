import { Module } from '@nestjs/common';
import { CreateNode } from './application/use-cases/nodes/create-node.js';
import { DeactivateNode } from './application/use-cases/nodes/deactivate-node.js';
import { GetNode } from './application/use-cases/nodes/get-node.js';
import { GetNodeTree } from './application/use-cases/nodes/get-node-tree.js';
import { ListNodes } from './application/use-cases/nodes/list-nodes.js';
import { MoveNode } from './application/use-cases/nodes/move-node.js';
import { UpdateNode } from './application/use-cases/nodes/update-node.js';
import { SeedBoundaryNodes } from './application/use-cases/seed-boundary-nodes.js';
import { RecordMovement } from './application/use-cases/movements/record-movement.js';
import { RecordMovementBatch } from './application/use-cases/movements/record-movement-batch.js';
import { ReverseMovement } from './application/use-cases/movements/reverse-movement.js';
import { GetMovementById } from './application/use-cases/stock/get-movement-by-id.js';
import { GetMovementHistory } from './application/use-cases/stock/get-movement-history.js';
import { GetOpenCustodies } from './application/use-cases/stock/get-open-custodies.js';
import { GetStock } from './application/use-cases/stock/get-stock.js';

/**
 * The use cases of inventory: the node graph and the ledger. Repositories,
 * clock, ids and the event publisher are bound by the root application
 * (spec 01 §6); they reach here through a global module.
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
  RecordMovement,
  ReverseMovement,
  RecordMovementBatch,
  GetStock,
  GetMovementHistory,
  GetMovementById,
  GetOpenCustodies,
];

@Module({ providers: USE_CASES, exports: USE_CASES })
export class InventoryModule {}
