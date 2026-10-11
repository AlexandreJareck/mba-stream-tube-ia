/**
 * Tests run inside the `nestjs-api` container, where the host-facing
 * S3_PUBLIC_ENDPOINT (e.g. http://localhost:9000) is not MinIO. Presigned
 * client URLs must therefore be signed for the internal endpoint, which is
 * what a client inside the Compose network would use.
 * Call before the ConfigModule factories run (i.e. before compiling modules).
 */
export function useInternalEndpointForPresignedUrls(): void {
  process.env.S3_PUBLIC_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://minio:9000';
}

/** PUTs a body to a presigned URL the way an external client would. */
export async function putToPresignedUrl(
  url: string,
  body: Buffer,
): Promise<string> {
  const res = await fetch(url, { method: 'PUT', body: new Uint8Array(body) });
  if (!res.ok) {
    throw new Error(`Presigned PUT failed: ${res.status} ${await res.text()}`);
  }
  return res.headers.get('etag') ?? '';
}

export const MiB = 1024 * 1024;
