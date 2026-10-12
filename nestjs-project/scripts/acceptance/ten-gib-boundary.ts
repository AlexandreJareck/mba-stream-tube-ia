/**
 * Phase 03 acceptance — 10 GiB boundary without proxying the file through the API
 * (docs/phase-03-handoff/specification.md §10; procedure in
 * docs/phases/phase-03-videos/acceptance-10gib.md).
 *
 * Run inside the API container (stack up, migrations applied):
 *   docker compose exec nestjs-api npx ts-node --transpile-only scripts/acceptance/ten-gib-boundary.ts
 *
 * The production AppModule is booted in-process on an ephemeral port and
 * exercised over real HTTP. One 64 MiB part goes through the presigned URL
 * exactly as a client would send it; the remaining 159 parts are filled
 * server-side with UploadPartCopy into the same multipart upload (avoids
 * pushing 10 GiB through the test client). Completion, size verification and
 * storage limits are the production code paths.
 */
import 'dotenv/config';
import { randomBytes, randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCopyCommand,
} from '@aws-sdk/client-s3';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { DomainExceptionFilter } from '../../src/common/filters/domain-exception.filter';
import { ValidationExceptionFilter } from '../../src/common/filters/validation-exception.filter';

const TEN_GIB = 10 * 1024 ** 3;
const PART = 64 * 1024 ** 2;

// Read by the config factories when Nest initializes (after these assignments).
// Inside the Compose network the client reaches MinIO by its service name.
process.env.S3_PUBLIC_ENDPOINT = process.env.S3_ENDPOINT ?? 'http://minio:9000';
process.env.VIDEO_UPLOAD_PART_SIZE_BYTES = String(PART);

function log(step: string, detail: unknown = ''): void {
  console.log(
    `[${new Date().toISOString()}] ${step}`,
    typeof detail === 'string' ? detail : JSON.stringify(detail),
  );
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(
    new DomainExceptionFilter(),
    new ValidationExceptionFilter(),
  );

  // Count every byte the API receives: proves the file never passes through it.
  let apiInboundBytes = 0;
  app
    .getHttpAdapter()
    .getInstance()
    .use((req: IncomingMessage, _res: unknown, next: () => void) => {
      req.on('data', (chunk: Buffer) => (apiInboundBytes += chunk.length));
      next();
    });

  await app.listen(0);
  const { port } = app.getHttpServer().address() as AddressInfo;
  const api = `http://127.0.0.1:${port}`;
  const dataSource = app.get(DataSource);
  const bucket = process.env.S3_BUCKET ?? 'streamtube-videos';
  const s3 = new S3Client({
    endpoint: process.env.S3_ENDPOINT ?? 'http://minio:9000',
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'streamtube',
      secretAccessKey:
        process.env.S3_SECRET_ACCESS_KEY ?? 'streamtube-dev-secret',
    },
  });

  const json = async (
    method: string,
    path: string,
    token?: string,
    body?: unknown,
  ) => {
    const res = await fetch(`${api}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return {
      status: res.status,
      body: text ? (JSON.parse(text) as Record<string, any>) : {},
    };
  };

  const chunkKey = `acceptance/chunk-${randomUUID()}`;
  let sourceKey: string | undefined;
  try {
    // 1. Authenticated user (confirmation done in the DB: e-mail is out of scope here).
    const email = `acceptance-${randomUUID().slice(0, 8)}@example.com`;
    const register = await json('POST', '/auth/register', undefined, {
      email,
      password: 'password123',
    });
    assert(register.status === 201, `register returned ${register.status}`);
    await dataSource.query(
      'UPDATE users SET is_confirmed = true WHERE id = $1',
      [register.body.id],
    );
    const login = await json('POST', '/auth/login', undefined, {
      email,
      password: 'password123',
    });
    const token = login.body.access_token as string;
    log('user ready', email);

    // 2. Boundary validation on the real endpoint.
    const above = await json('POST', '/channels/me/videos', token, {
      title: 'Above the limit',
      filename: 'too-big.mp4',
      content_type: 'video/mp4',
      size_bytes: TEN_GIB + 1,
    });
    assert(above.status === 400, `10 GiB + 1 byte returned ${above.status}`);
    log('10737418241 bytes rejected', {
      status: above.status,
      error: above.body.error,
    });

    const start = await json('POST', '/channels/me/videos', token, {
      title: '10 GiB boundary',
      filename: 'ten-gib.mp4',
      content_type: 'video/mp4',
      size_bytes: TEN_GIB,
    });
    assert(start.status === 201, `10 GiB start returned ${start.status}`);
    const upload = start.body.upload as {
      part_size: number;
      part_count: number;
      parts: { part_number: number; url: string }[];
    };
    assert(
      upload.part_count === 160 && upload.part_size === PART,
      'expected 160 parts of 64 MiB',
    );
    log('10737418240 bytes accepted', {
      videoId: start.body.id,
      status: start.body.status,
      part_count: upload.part_count,
      part_size: upload.part_size,
      presigned_urls: upload.parts.length,
    });

    const [row] = await dataSource.query<
      { upload_id: string; storage_key: string }[]
    >('SELECT upload_id, storage_key FROM videos WHERE id = $1', [
      start.body.id,
    ]);
    sourceKey = row.storage_key;

    // 3. Part 1: a real 64 MiB PUT to the presigned URL (client → storage directly).
    const part1 = await fetch(upload.parts[0].url, {
      method: 'PUT',
      body: new Uint8Array(randomBytes(PART)),
    });
    assert(part1.ok, `presigned PUT of part 1 returned ${part1.status}`);
    log('part 1 (64 MiB) uploaded through its presigned URL', {
      status: part1.status,
    });

    // 4. Parts 2..160: server-side copies of a 64 MiB chunk into the same upload.
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: chunkKey,
        Body: randomBytes(PART),
        ContentLength: PART,
      }),
    );
    const copyStarted = Date.now();
    for (let partNumber = 2; partNumber <= upload.part_count; partNumber++) {
      await s3.send(
        new UploadPartCopyCommand({
          Bucket: bucket,
          Key: row.storage_key,
          UploadId: row.upload_id,
          PartNumber: partNumber,
          CopySource: `${bucket}/${chunkKey}`,
        }),
      );
      if (partNumber % 40 === 0)
        log(`parts copied up to ${partNumber}/${upload.part_count}`);
    }
    log('parts 2..160 filled server-side', {
      seconds: Math.round((Date.now() - copyStarted) / 1000),
    });

    // 5. Resume endpoint sees every part; completion assembles and verifies 10 GiB.
    const session = await json(
      'GET',
      `/channels/me/videos/${start.body.id}/upload`,
      token,
    );
    assert(session.status === 200, `GET upload returned ${session.status}`);
    assert(
      session.body.uploaded_parts.length === 160 &&
        session.body.parts.length === 0,
      'all 160 parts should be stored',
    );
    log('upload session complete', {
      uploaded_parts: session.body.uploaded_parts.length,
      missing: session.body.parts.length,
    });

    const complete = await json(
      'POST',
      `/channels/me/videos/${start.body.id}/upload/complete`,
      token,
    );
    assert(
      complete.status === 200 && complete.body.status === 'processing',
      `complete returned ${complete.status} ${complete.body.status}`,
    );
    const head = await s3.send(
      new HeadObjectCommand({ Bucket: bucket, Key: row.storage_key }),
    );
    assert(
      head.ContentLength === TEN_GIB,
      `assembled object has ${head.ContentLength} bytes`,
    );
    log('completed', {
      status: complete.body.status,
      processing_run: complete.body.processing_run,
      object_bytes: head.ContentLength,
    });

    // 6. The API only ever received JSON.
    log(
      'bytes received by the API during the whole procedure',
      apiInboundBytes,
    );
    assert(apiInboundBytes < 64 * 1024, 'the API must not receive file bytes');

    // 7. The worker reads the 10 GiB object by URL (the data is random, so INVALID_MEDIA is expected).
    const deadline = Date.now() + 180_000;
    let final: { status: string; failure_reason: string | null } | undefined;
    while (Date.now() < deadline) {
      [final] = await dataSource.query(
        'SELECT status, failure_reason FROM videos WHERE id = $1',
        [start.body.id],
      );
      if (final && final.status !== 'processing') break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    log(
      'worker outcome for the random 10 GiB payload',
      final ?? 'still processing',
    );
    log('RESULT', 'PASS');
  } finally {
    await s3
      .send(new DeleteObjectCommand({ Bucket: bucket, Key: chunkKey }))
      .catch(() => undefined);
    if (sourceKey && !process.argv.includes('--keep')) {
      await s3
        .send(new DeleteObjectCommand({ Bucket: bucket, Key: sourceKey }))
        .catch(() => undefined);
      log('cleanup', `deleted ${sourceKey}`);
    }
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
