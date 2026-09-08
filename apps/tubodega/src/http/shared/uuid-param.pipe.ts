import { Injectable, type PipeTransform } from '@nestjs/common';
import { DomainError } from '@app/common';

/**
 * A resource that does not exist for this organization — including one whose
 * id is not even well formed. 404 and never anything else (I-6): a malformed
 * id must not reach the database, where a uuid cast would surface as a 500 and
 * fill the log with noise for what is plainly a client mistake.
 */
export class ResourceNotFoundError extends DomainError {
  readonly type = 'not-found';
  readonly status = 404;
  constructor() {
    super('No existe ese recurso');
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class UuidParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== 'string' || !UUID.test(value)) throw new ResourceNotFoundError();
    return value;
  }
}
