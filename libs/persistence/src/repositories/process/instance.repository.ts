import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, type OrgId, type Page, type ProcessInstanceId, type UnitOfWork } from '@app/common';
import {
  ProcessInstanceIdTakenError,
  type ProcessInstance, type ProcessInstanceFilter, type ProcessInstancePage,
  type ProcessInstanceRepository,
} from '@app/process';
import { ProcessInstanceDao } from '../../dao/process-instance.dao.js';
import { RecordNotFoundError, UniqueViolationError } from '../../dao/base/errors.js';
import { processInstanceValues, toProcessInstance } from './mapping.js';

const translate = (id: string) => (e: unknown): never => {
  // The client's UUIDv7 is the primary key, so a retry that slipped past the
  // idempotency table lands here (spec 13 §12, the mould of `movement-id-taken`).
  if (e instanceof UniqueViolationError && e.constraint === 'process_instance_pkey') {
    throw new ProcessInstanceIdTakenError(id);
  }
  // The 23503 of the composite FK to `(org_id, code, version)` is deliberately
  // NOT translated: it is P-1, and the use case already resolved the template,
  // so one reaching here means the domain let something through.
  throw e;
};

@Injectable()
export class KyselyProcessInstanceRepository implements ProcessInstanceRepository {
  constructor(
    private readonly dao: ProcessInstanceDao,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async findById(orgId: OrgId, id: ProcessInstanceId): Promise<ProcessInstance | null> {
    const row = await this.dao.findUnique(orgId, id);
    return row ? toProcessInstance(row) : null;
  }

  /**
   * `createdAt` and nothing else (D-62). It is the column this plan indexes,
   * and the same reasoning as the movement history: a sort with no index behind
   * it invites a seq scan over a table that grows with every guided operation.
   */
  async list(
    orgId: OrgId, filter: ProcessInstanceFilter, page: ProcessInstancePage,
  ): Promise<Page<ProcessInstance>> {
    const found = await this.dao.findPage(orgId, {
      take: page.limit,
      ...(page.cursor !== undefined ? { cursor: page.cursor } : {}),
      orderBy: { createdAt: page.sort.dir },
      where: {
        ...(filter.state !== undefined ? { state: filter.state } : {}),
        ...(filter.templateCode !== undefined ? { templateCode: filter.templateCode as string } : {}),
        ...(filter.actorId !== undefined ? { actorId: filter.actorId as string } : {}),
      },
    });
    return { ...found, data: found.data.map(toProcessInstance) };
  }

  /**
   * Update first, insert if it was not there: the same shape as every other
   * repository of the house. Returns the version the row ended up with — the
   * caller cannot know it, and the entity does not carry it forward (D-31).
   */
  async save(instance: ProcessInstance, expectedVersion?: number): Promise<number> {
    const data = processInstanceValues(instance);
    try {
      const row = await this.uow.run(() =>
        this.dao.update(
          instance.orgId, instance.id, data,
          expectedVersion !== undefined ? { expectedVersion } : {},
        ),
      );
      return row.version;
    } catch (e) {
      if (e instanceof RecordNotFoundError) {
        const row = await this.uow
          .run(() => this.dao.create({ id: instance.id, orgId: instance.orgId, ...data }))
          .catch(translate(instance.id));
        return row.version;
      }
      return translate(instance.id)(e);
    }
  }
}
