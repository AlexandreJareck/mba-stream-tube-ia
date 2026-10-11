/**
 * Storage-level outcomes that callers translate into domain decisions
 * (e.g. an aborted multipart upload or a missing source object).
 * Infrastructure failures surface as `StorageUnavailableException` instead.
 */
export class StorageUploadNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Multipart upload not found for ${key}`);
    this.name = 'StorageUploadNotFoundError';
  }
}

export class StorageObjectNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Object not found: ${key}`);
    this.name = 'StorageObjectNotFoundError';
  }
}
