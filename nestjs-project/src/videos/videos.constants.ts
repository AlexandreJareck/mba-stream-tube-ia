export const PUBLIC_ID_LENGTH = 11;

/** S3 multipart limits (AWS S3 multipart limits page). */
export const S3_MAX_PARTS = 10_000;

export const ALLOWED_VIDEO_CONTENT_TYPES = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
] as const;

export const VIDEO_QUEUE = {
  NAME: 'video-processing',
  PROCESS_JOB: 'video.process',
  SWEEP_JOB: 'uploads.sweep',
  SWEEP_SCHEDULER_ID: 'uploads-sweep',
  RECONCILE_JOB: 'processing.reconcile',
  RECONCILE_SCHEDULER_ID: 'processing-reconcile',
} as const;

/** Current version of the `video.process` message contract (phase-03-videos/TD-05). */
export const VIDEO_PROCESS_MESSAGE_VERSION = 1;

/** Failed jobs are retained for 7 days as the dead-letter set (phase-03-videos/TD-06). */
export const FAILED_JOB_RETENTION_SECONDS = 7 * 24 * 3600;
export const COMPLETED_JOB_RETENTION_SECONDS = 24 * 3600;

export const UPLOAD_SWEEP_BATCH_SIZE = 100;
export const PROCESSING_RECONCILE_BATCH_SIZE = 100;

export const THUMBNAIL_WIDTH = 640;
export const THUMBNAIL_CONTENT_TYPE = 'image/jpeg';
