export enum VideoStatus {
  DRAFT = 'draft',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

/** Internal failure codes persisted in `videos.failure_reason` (never raw errors). */
export enum VideoFailureReason {
  INVALID_MEDIA = 'INVALID_MEDIA',
  PROCESSING_FAILED = 'PROCESSING_FAILED',
  UPLOAD_EXPIRED = 'UPLOAD_EXPIRED',
}
