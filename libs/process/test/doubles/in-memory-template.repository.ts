import type { OrgId } from '@app/common';
import type { ProcessTemplate, ProcessTemplateRepository, TemplateCode } from '@app/process';

/** En memoria, con la misma clave natural que la tabla: (org, code, version). */
export class InMemoryTemplateRepository implements ProcessTemplateRepository {
  readonly rows: ProcessTemplate[] = [];
  /** Cuántas veces se escribió de verdad; es lo que delata una siembra que duplica. */
  escrituras = 0;
  /** Instancias de mentira, por (code, version), para P-9. */
  readonly instancias = new Set<string>();

  findActive(orgId: OrgId, code: TemplateCode): Promise<ProcessTemplate | null> {
    return Promise.resolve(
      this.rows.find((t) => t.orgId === orgId && t.code === code && t.active) ?? null,
    );
  }

  findVersion(orgId: OrgId, code: TemplateCode, version: number): Promise<ProcessTemplate | null> {
    return Promise.resolve(
      this.rows.find((t) => t.orgId === orgId && t.code === code && t.version === version) ?? null,
    );
  }

  activeVersion(orgId: OrgId, code: TemplateCode): Promise<number | null> {
    return Promise.resolve(
      this.rows.find((t) => t.orgId === orgId && t.code === code && t.active)?.version ?? null,
    );
  }

  versionExists(orgId: OrgId, code: TemplateCode, version: number): Promise<boolean> {
    return Promise.resolve(
      this.rows.some((t) => t.orgId === orgId && t.code === code && t.version === version),
    );
  }

  /**
   * El repositorio real hace esto con un UPDATE sobre la columna `active`, sin
   * construir la entidad. El doble tiene que hacer lo mismo —no llamar a
   * `deactivated()`— o mentiría justo donde importa: publicar una versión sana
   * encima de una plantilla que ya no se puede construir es el único camino de
   * salida para una organización que publicó una inválida.
   */
  deactivateAll(orgId: OrgId, code: TemplateCode): Promise<void> {
    this.rows.forEach((t, i) => {
      if (t.orgId === orgId && t.code === code && t.active) {
        this.escrituras += 1;
        this.rows[i] = Object.assign(Object.create(Object.getPrototypeOf(t) as object), t, {
          active: false,
        }) as ProcessTemplate;
      }
    });
    return Promise.resolve();
  }

  listActive(orgId: OrgId): Promise<ProcessTemplate[]> {
    return Promise.resolve(
      this.rows.filter((t) => t.orgId === orgId && t.active).sort((a, b) => a.code.localeCompare(b.code)),
    );
  }

  hasInstances(_orgId: OrgId, code: TemplateCode, version: number): Promise<boolean> {
    return Promise.resolve(this.instancias.has(`${code}@${version}`));
  }

  save(template: ProcessTemplate): Promise<void> {
    this.escrituras += 1;
    const i = this.rows.findIndex((t) => t.orgId === template.orgId && t.id === template.id);
    if (i >= 0) this.rows[i] = template;
    else this.rows.push(template);
    return Promise.resolve();
  }
}
