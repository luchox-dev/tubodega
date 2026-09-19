import { decodeCursor, encodeCursor, type Cursor, type OrgId, type Page, type ProcessInstanceId } from '@app/common';
import {
  ProcessInstance, ProcessInstanceIdTakenError,
  type ProcessInstanceFilter, type ProcessInstancePage, type ProcessInstanceRepository,
} from '@app/process';

/**
 * Lo que hace el repositorio de verdad al leer: la `version` de la entidad es
 * la de la **fila**, no la que traía el objeto que se guardó. Sin esto el doble
 * mentiría justo en lo que el bloqueo optimista mide, y dos escrituras
 * seguidas en la misma prueba se darían de bruces con una versión obsoleta que
 * en Postgres no existiría.
 */
const conVersion = (instance: ProcessInstance, version: number): ProcessInstance =>
  ProcessInstance.rehydrate({
    id: instance.id,
    orgId: instance.orgId,
    templateCode: instance.templateCode,
    templateVersion: instance.templateVersion,
    state: instance.state,
    ...(instance.currentStepId !== undefined ? { currentStepId: instance.currentStepId } : {}),
    context: instance.context,
    actorId: instance.actorId,
    version,
  });

/**
 * Con comportamiento, no un mock: respeta el bloqueo optimista y choca contra
 * el id repetido. Un doble que no muerda deja probando nada a las pruebas que
 * existen justo para ver que muerde.
 */
export class InMemoryInstanceRepository implements ProcessInstanceRepository {
  readonly rows = new Map<string, { instance: ProcessInstance; version: number; createdAt: number }>();
  /** Reloj de inserción, para poder ordenar por `createdAt` sin pedir uno. */
  private reloj = 0;

  findById(orgId: OrgId, id: ProcessInstanceId): Promise<ProcessInstance | null> {
    const row = this.rows.get(id);
    return Promise.resolve(row && row.instance.orgId === orgId ? row.instance : null);
  }

  list(orgId: OrgId, filter: ProcessInstanceFilter, page: ProcessInstancePage): Promise<Page<ProcessInstance>> {
    const todas = [...this.rows.values()]
      .filter((r) => r.instance.orgId === orgId)
      .filter((r) => filter.state === undefined || r.instance.state === filter.state)
      .filter((r) => filter.templateCode === undefined || r.instance.templateCode === filter.templateCode)
      .filter((r) => filter.actorId === undefined || r.instance.actorId === filter.actorId)
      .sort((a, b) => (page.sort.dir === 'desc' ? b.createdAt - a.createdAt : a.createdAt - b.createdAt));

    const desde = page.cursor ? Number(decodeCursor(page.cursor)?.[0] ?? 0) : null;
    const tras = desde === null
      ? todas
      : todas.filter((r) => (page.sort.dir === 'desc' ? r.createdAt < desde : r.createdAt > desde));

    const data = tras.slice(0, page.limit).map((r) => r.instance);
    const hasMore = tras.length > page.limit;
    const ultimo = tras[page.limit - 1];
    return Promise.resolve({
      data,
      hasMore,
      ...(hasMore && ultimo ? { nextCursor: encodeCursor([ultimo.createdAt]) as Cursor } : {}),
    });
  }

  save(instance: ProcessInstance, expectedVersion?: number): Promise<number> {
    const previa = this.rows.get(instance.id);
    if (!previa) {
      if (expectedVersion !== undefined) return Promise.reject(new Error('no existe la fila que se pretende actualizar'));
      this.reloj += 1;
      this.rows.set(instance.id, { instance: conVersion(instance, 1), version: 1, createdAt: this.reloj });
      return Promise.resolve(1);
    }
    if (previa.instance.orgId !== instance.orgId) {
      return Promise.reject(new ProcessInstanceIdTakenError(instance.id));
    }
    if (expectedVersion !== undefined && previa.version !== expectedVersion) {
      return Promise.reject(new Error(`versión obsoleta: esperaba ${expectedVersion}, hay ${previa.version}`));
    }
    const version = previa.version + 1;
    this.rows.set(instance.id, { ...previa, instance: conVersion(instance, version), version });
    return Promise.resolve(version);
  }

  /** Lo que el caso de uso no puede montar por sí solo: una fila ya guardada. */
  sembrar(instance: ProcessInstance): void {
    this.reloj += 1;
    this.rows.set(instance.id, { instance, version: instance.version, createdAt: this.reloj });
  }
}
