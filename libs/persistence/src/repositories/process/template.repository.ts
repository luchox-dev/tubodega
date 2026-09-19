import { Inject, Injectable } from '@nestjs/common';
import { UNIT_OF_WORK, type OrgId, type UnitOfWork } from '@app/common';
import { TemplateVersionTakenError, type ProcessTemplate, type ProcessTemplateRepository, type TemplateCode } from '@app/process';
import { ProcessTemplateDao } from '../../dao/process-template.dao.js';
import { RecordNotFoundError, UniqueViolationError } from '../../dao/base/errors.js';
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

  activeVersion(orgId: OrgId, code: TemplateCode): Promise<number | null> {
    return this.dao.activeVersion(orgId, code as string);
  }

  versionExists(orgId: OrgId, code: TemplateCode, version: number): Promise<boolean> {
    return this.dao.versionExists(orgId, code as string, version);
  }

  deactivateAll(orgId: OrgId, code: TemplateCode): Promise<void> {
    return this.uow.run(() => this.dao.deactivateAll(orgId, code as string));
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
      try {
        await this.uow.run(() => this.dao.create({ id: template.id, orgId: template.orgId, ...data }));
      } catch (inner) {
        // `CreateTemplateVersion` ya comprueba que la versión no exista, y eso
        // basta mientras publique uno solo. Dos clientes a la vez leen ambos
        // «no existe» y ambos insertan: el segundo choca contra
        // UNIQUE (org_id, code, version), que es justo el 23505 que este error
        // se creó para no dejar salir como 500 (D-61). La comprobación previa
        // da el mensaje; la restricción da la garantía.
        if (inner instanceof UniqueViolationError && inner.constraint === 'process_template_org_id_code_version_key') {
          throw new TemplateVersionTakenError(template.code as string, template.version);
        }
        throw inner;
      }
    }
  }
}
