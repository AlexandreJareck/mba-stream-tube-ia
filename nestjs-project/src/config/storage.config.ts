import { registerAs } from '@nestjs/config';

export default registerAs('storage', () => ({
  // Endpoint used by the API and worker containers (Compose service name).
  endpoint: process.env.S3_ENDPOINT || 'http://minio:9000',
  // Endpoint embedded in presigned URLs handed to clients outside Docker.
  publicEndpoint:
    process.env.S3_PUBLIC_ENDPOINT ||
    process.env.S3_ENDPOINT ||
    'http://minio:9000',
  region: process.env.S3_REGION || 'us-east-1',
  accessKeyId: process.env.S3_ACCESS_KEY_ID || 'streamtube',
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || 'streamtube-dev-secret',
  bucket: process.env.S3_BUCKET || 'streamtube-videos',
  forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') === 'true',
}));
