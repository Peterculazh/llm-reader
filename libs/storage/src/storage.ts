// The API and worker both hold the whole file in memory, so keep it bounded.
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

export interface StoredObjectMeta {
  contentType: string;
  filename: string;
}

export interface StoredObject extends StoredObjectMeta {
  body: Buffer;
}

// Backend-neutral so callers don't depend on S3 error types.
export class ObjectNotFoundError extends Error {}

// Abstract class doubles as the DI token, same as EventPublisher.
export abstract class ObjectStorage {
  abstract put(key: string, body: Buffer, meta: StoredObjectMeta): Promise<void>;
  abstract get(key: string): Promise<StoredObject>;
}
