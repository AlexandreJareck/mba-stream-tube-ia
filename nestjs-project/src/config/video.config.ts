import { registerAs } from '@nestjs/config';

const int = (value: string | undefined, fallback: number): number =>
  parseInt(value ?? String(fallback), 10);

export default registerAs('video', () => ({
  maxSizeBytes: int(process.env.VIDEO_MAX_SIZE_BYTES, 10_737_418_240),
  uploadPartSizeBytes: int(
    process.env.VIDEO_UPLOAD_PART_SIZE_BYTES,
    67_108_864,
  ),
  uploadUrlTtlSeconds: int(process.env.VIDEO_UPLOAD_URL_TTL_SECONDS, 3600),
  uploadSessionTtlHours: int(process.env.VIDEO_UPLOAD_SESSION_TTL_HOURS, 24),
  processingAttempts: int(process.env.VIDEO_PROCESSING_ATTEMPTS, 3),
  processingBackoffMs: int(process.env.VIDEO_PROCESSING_BACKOFF_MS, 10_000),
  workerConcurrency: int(process.env.WORKER_CONCURRENCY, 2),
  uploadSweepIntervalMs: int(process.env.UPLOAD_SWEEP_INTERVAL_MS, 900_000),
  processingReconcileIntervalMs: int(
    process.env.PROCESSING_RECONCILE_INTERVAL_MS,
    60_000,
  ),
}));
