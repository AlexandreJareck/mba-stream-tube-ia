import * as Joi from 'joi';

// S3 multipart rules: parts >= 5 MiB (except the last), at most 10,000 parts.
export const MIN_UPLOAD_PART_SIZE_BYTES = 5 * 1024 * 1024;
// Phase 03 upper bound for a single video: 10 GiB, inclusive (phase-03-videos/TD-10).
export const MAX_VIDEO_SIZE_BYTES = 10 * 1024 * 1024 * 1024;

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),
  CONFIRMATION_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  PASSWORD_RESET_TOKEN_EXPIRATION_HOURS: Joi.number().default(1),
  APP_URL: Joi.string().uri().default('http://localhost:3000'),
  MAIL_HOST: Joi.string().default('mailpit'),
  MAIL_PORT: Joi.number().default(1025),
  MAIL_FROM: Joi.string().default('"StreamTube" <noreply@streamtube.com>'),
  SWAGGER_ENABLED: Joi.string().valid('true', 'false').default('false'),
  S3_ENDPOINT: Joi.string().uri().default('http://minio:9000'),
  S3_PUBLIC_ENDPOINT: Joi.string().uri(),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_ACCESS_KEY_ID: Joi.string().default('streamtube'),
  S3_SECRET_ACCESS_KEY: Joi.string().default('streamtube-dev-secret'),
  S3_BUCKET: Joi.string().default('streamtube-videos'),
  S3_FORCE_PATH_STYLE: Joi.string().valid('true', 'false').default('true'),
  REDIS_HOST: Joi.string().default('redis'),
  REDIS_PORT: Joi.number().port().default(6379),
  VIDEO_MAX_SIZE_BYTES: Joi.number()
    .integer()
    .min(1)
    .max(MAX_VIDEO_SIZE_BYTES)
    .default(MAX_VIDEO_SIZE_BYTES),
  VIDEO_UPLOAD_PART_SIZE_BYTES: Joi.number()
    .integer()
    .min(MIN_UPLOAD_PART_SIZE_BYTES)
    .default(64 * 1024 * 1024),
  VIDEO_UPLOAD_URL_TTL_SECONDS: Joi.number()
    .integer()
    .min(60)
    .max(7 * 24 * 3600)
    .default(3600),
  VIDEO_UPLOAD_SESSION_TTL_HOURS: Joi.number().integer().min(1).default(24),
  VIDEO_PROCESSING_ATTEMPTS: Joi.number().integer().min(1).default(3),
  VIDEO_PROCESSING_BACKOFF_MS: Joi.number().integer().min(0).default(10000),
  WORKER_CONCURRENCY: Joi.number().integer().min(1).default(2),
  UPLOAD_SWEEP_INTERVAL_MS: Joi.number().integer().min(1000).default(900000),
  PROCESSING_RECONCILE_INTERVAL_MS: Joi.number()
    .integer()
    .min(1000)
    .default(60000),
});
