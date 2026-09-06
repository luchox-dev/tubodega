/** A DAO was invoked outside `UnitOfWork.run()` / `runAs()`. A composition bug, never a business error (spec 08 §6). */
export class NoActiveTransactionError extends Error {
  constructor() {
    super('No active transaction: data access must happen inside UnitOfWork.run()');
    this.name = 'NoActiveTransactionError';
  }
}
