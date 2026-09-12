import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, type OrgId, type UnitOfWork } from '@app/common';
import type { ProcessTemplate, ProcessTemplateRepository, TemplateCode } from '@app/process';
import { ProcessTemplateDao } from '../../dao/process-template.dao.js';
import { RecordNotFoundError } from '../../dao/base/errors.js';
import { processTemplateValues, toProcessTemplate } from './mapping.js';

@Injectable()
export class KyselyProcessTemplateRepository implements ProcessTemplateRepository {
  constructor(
    private readonly dao: ProcessTemplateDao,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
  ) {}

  async findActive(orgId: OrgId, code: TemplateCode): Promise<ProcessTemplate | null> {
    const row = await this.dao.findFirst(orgId, { where: { code: code as string, active: true } });
    return row ? toProcessTemplate(row) : null;
  }

  async findVersion(orgId: OrgId, code: TemplateCode, version: number): Promise<ProcessTemplate | null> {
    const row = await this.dao.findFirst(orgId, { where: { code: code as string, version } });
    return row ? toProcessTemplate(row) : null;
  }

  /** Six rows, and the day they are per tenant they will still be few: no cursor. */
  async listActive(orgId: OrgId): Promise<ProcessTemplate[]> {
    const rows = await this.dao.findMany(orgId, { where: { active: true }, orderBy: { code: 'asc' } });
    return rows.map(toProcessTemplate);
  }

  hasInstances(orgId: OrgId, code: TemplateCode, version: number): Promise<boolean> {
    return this.dao.hasInstances(orgId, code as string, version);
  }

  /**
   * Update first, insert if it was not there: the same shape as every other
   * repository of the house. Both writes sit in a savepoint, so a 23505 on
   * `(org_id, code, version)` does not abort the transaction that creates the
   * organization — which is the whole reason the seeder reads before writing.
   */
  async save(template: ProcessTemplate): Promise<void> {
    const data = processTemplateValues(template);
    try {
      await this.uow.run(() => this.dao.update(template.orgId, template.id, data));
    } catch (e) {
      if (!(e instanceof RecordNotFoundError)) throw e;
      await this.uow.run(() => this.dao.create({ id: template.id, orgId: template.orgId, ...data }));
    }
  }
}
