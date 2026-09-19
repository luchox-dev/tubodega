import { Module } from '@nestjs/common';
import { CatalogModule } from '@app/catalog';
import { InventoryModule } from '@app/inventory';
import { mvpRegistry } from './domain/handlers/index.js';
import { LinearRunner } from './domain/linear-runner.js';
import { PROCESS_RUNNER } from './domain/runner.js';
import { EffectApplier } from './application/effect-applier.js';
import { HandlerDepsFactory } from './application/handler-deps.factory.js';
import { CancelProcess } from './application/use-cases/cancel-process.js';
import { CompleteStep } from './application/use-cases/complete-step.js';
import { CreateTemplateVersion } from './application/use-cases/create-template-version.js';
import { GetProcessInstance } from './application/use-cases/get-process-instance.js';
import { ListProcessInstances } from './application/use-cases/list-process-instances.js';
import { StartProcess } from './application/use-cases/start-process.js';
import { GetActiveTemplate } from './application/use-cases/get-active-template.js';
import { ListTemplates } from './application/use-cases/list-templates.js';
import { SeedFactoryTemplates } from './application/use-cases/seed-factory-templates.js';

/**
 * The engine. Repositories, clock, ids and the event publisher are bound by the
 * root application (spec 01 §6) and reach here through a global module; what
 * this module does import are `catalog` and `inventory`, because the effect
 * applier and the handler deps inject **their use cases by class** — there are
 * no bridge ports (D-46), and R-2 allows exactly these two edges.
 */
const USE_CASES = [
  ListTemplates,
  GetActiveTemplate,
  SeedFactoryTemplates,
  CreateTemplateVersion,
  StartProcess,
  CompleteStep,
  CancelProcess,
  GetProcessInstance,
  ListProcessInstances,
];


/**
 * The one line that changes the day of the workflow: `GraphRunner` will
 * implement the same interface, read the same tables and produce the same
 * effects (spec 13 §4.1, D-66).
 */
const RUNNER = { provide: PROCESS_RUNNER, useFactory: () => new LinearRunner(mvpRegistry()) };

@Module({
  imports: [CatalogModule, InventoryModule],
  providers: [...USE_CASES, HandlerDepsFactory, EffectApplier, RUNNER],
  exports: [...USE_CASES, HandlerDepsFactory, EffectApplier, RUNNER],
})
export class ProcessModule {}
