import { Global, Module } from '@nestjs/common';
import { CLOCK, EVENT_PUBLISHER, ID_GENERATOR, SystemClock, Uuidv7Generator } from '@app/common';
import {
  KyselyOrganizationRepository,
  KyselyOutboxEventPublisher,
  KyselySessionRepository,
  KyselyUserRepository,
  PersistenceModule,
} from '@app/persistence';
import { ORGANIZATION_REPOSITORY, ORG_PROVISIONER, SESSION_REPOSITORY, USER_REPOSITORY } from '@app/tenancy';
import { CompositeOrgProvisioner, ORG_SEEDERS } from './tenancy/org-provisioner.adapter.js';

/**
 * The composition root's port ↔ adapter table (spec 01 §6). Global so that
 * library modules resolve their ports without importing persistence (R-4).
 */
@Global()
@Module({
  imports: [PersistenceModule],
  providers: [
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: Uuidv7Generator },
    { provide: EVENT_PUBLISHER, useExisting: KyselyOutboxEventPublisher },
    { provide: ORGANIZATION_REPOSITORY, useExisting: KyselyOrganizationRepository },
    { provide: USER_REPOSITORY, useExisting: KyselyUserRepository },
    { provide: SESSION_REPOSITORY, useExisting: KyselySessionRepository },
    { provide: ORG_SEEDERS, useValue: [] },
    { provide: ORG_PROVISIONER, useClass: CompositeOrgProvisioner },
  ],
  exports: [
    PersistenceModule,
    CLOCK,
    ID_GENERATOR,
    EVENT_PUBLISHER,
    ORGANIZATION_REPOSITORY,
    USER_REPOSITORY,
    SESSION_REPOSITORY,
    ORG_PROVISIONER,
  ],
})
export class AdaptersModule {}
