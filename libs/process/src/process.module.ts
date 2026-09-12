import { Module } from '@nestjs/common';
import { GetActiveTemplate } from './application/use-cases/get-active-template.js';
import { ListTemplates } from './application/use-cases/list-templates.js';
import { SeedFactoryTemplates } from './application/use-cases/seed-factory-templates.js';

/**
 * The use cases of process. The template repository, the ids and the clock are
 * bound by the root application (spec 01 §6); they reach here through a global
 * module.
 */
const USE_CASES = [ListTemplates, GetActiveTemplate, SeedFactoryTemplates];

@Module({ providers: USE_CASES, exports: USE_CASES })
export class ProcessModule {}
