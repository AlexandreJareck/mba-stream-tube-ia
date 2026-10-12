import { randomBytes, randomUUID } from 'node:crypto';
import { text } from 'node:stream/consumers';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import storageConfig from '../config/storage.config';
import {
  MiB,
  putToPresignedUrl,
  useInternalEndpointForPresignedUrls,
} from '../test/storage';
import { StorageUploadNotFoundError } from './storage.errors';
import { StorageModule } from './storage.module';
import { StorageService } from './storage.service';

describe('StorageService (integration, MinIO)', () => {
  let module: TestingModule;
  let storage: StorageService;

  beforeAll(async () => {
    useInternalEndpointForPresignedUrls();
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, load: [storageConfig] }),
        StorageModule,
      ],
    }).compile();
    storage = module.get(StorageService);
  });

  afterAll(async () => {
    await module.close();
  });

  const newKey = () => `test/${randomUUID()}/source`;

  it('should assemble a two-part upload sent directly to presigned URLs', async () => {
    const key = newKey();
    const part1 = randomBytes(5 * MiB);
    const part2 = randomBytes(1024);
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');

    await putToPresignedUrl(
      await storage.presignUploadPart(key, uploadId, 1, 600),
      part1,
    );
    await putToPresignedUrl(
      await storage.presignUploadPart(key, uploadId, 2, 600),
      part2,
    );

    const parts = await storage.listParts(key, uploadId);
    expect(parts.map((p) => [p.partNumber, p.size])).toEqual([
      [1, 5 * MiB],
      [2, 1024],
    ]);

    await storage.completeMultipartUpload(key, uploadId, parts);

    const head = await storage.headObject(key);
    expect(head).toEqual({ size: 5 * MiB + 1024, contentType: 'video/mp4' });
  });

  it('should stream a single byte range of an object', async () => {
    const key = newKey();
    await storage.putObject(key, Buffer.from('0123456789abcdef'), 'text/plain');

    const { body, contentLength } = await storage.getObjectStream(key, {
      start: 0,
      end: 9,
    });

    expect(contentLength).toBe(10);
    await expect(text(body)).resolves.toBe('0123456789');
  });

  it('should return null when heading a missing object', async () => {
    await expect(storage.headObject(newKey())).resolves.toBeNull();
  });

  it('should abort an upload and treat a second abort as done', async () => {
    const key = newKey();
    const uploadId = await storage.createMultipartUpload(key, 'video/mp4');

    await storage.abortMultipartUpload(key, uploadId);

    await expect(storage.listParts(key, uploadId)).rejects.toBeInstanceOf(
      StorageUploadNotFoundError,
    );
    await expect(
      storage.abortMultipartUpload(key, uploadId),
    ).resolves.toBeUndefined();
  });

  it('should presign an internal GET URL readable over HTTP', async () => {
    const key = newKey();
    await storage.putObject(key, Buffer.from('hello'), 'text/plain');

    const url = await storage.presignInternalGet(key, 60);
    const res = await fetch(url, { headers: { Range: 'bytes=1-3' } });

    expect(res.status).toBe(206);
    await expect(res.text()).resolves.toBe('ell');
  });
});
