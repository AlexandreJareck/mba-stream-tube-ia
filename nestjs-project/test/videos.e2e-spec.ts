import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { putToPresignedUrl } from '../src/test/storage';
import { waitFor } from '../src/test/wait';
import { WorkerModule } from '../src/worker/worker.module';
import {
  binaryParser,
  bodyOf,
  createTestApp,
  registerConfirmedUser,
  TestApp,
  VideoBody,
  VideoUploadBody,
} from './helpers/app';

interface PublicVideoBody {
  public_id: string;
  duration_seconds: number;
  thumbnail_url: string;
  stream_url: string;
  download_url: string;
}

const sha256 = (data: Buffer) =>
  createHash('sha256').update(data).digest('hex');

/**
 * Full Phase 03 flow against the real stack (PostgreSQL, MinIO, Redis/BullMQ
 * and FFmpeg): the bytes go straight to storage, a worker processes the video
 * and the API serves it by its public id. The WorkerModule runs in-process so
 * the test does not depend on the code loaded by the `worker` container.
 */
describe('Video upload → processing → playback (e2e)', () => {
  let ctx: TestApp;
  let worker: TestingModule;
  let fixture: Buffer;

  beforeAll(async () => {
    ctx = await createTestApp();
    worker = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    await worker.init();
    fixture = await readFile(join(__dirname, 'fixtures/sample.mp4'));
  });

  afterAll(async () => {
    await worker.close();
    await ctx.app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(ctx.dataSource);
    ctx.throttlerStorage.storage.clear();
  });

  it('uploads directly to storage, processes to ready and streams by public id', async () => {
    const http = () => request(ctx.app.getHttpServer());
    const { accessToken } = await registerConfirmedUser(
      ctx,
      'creator@example.com',
    );
    const auth = { Authorization: `Bearer ${accessToken}` };

    // 1. Start: draft + presigned part URLs (the API never receives the bytes).
    const started = bodyOf<VideoUploadBody>(
      await http()
        .post('/channels/me/videos')
        .set(auth)
        .send({
          title: 'End to end',
          filename: 'sample.mp4',
          content_type: 'video/mp4',
          size_bytes: fixture.length,
        })
        .expect(201),
    );
    expect(started.status).toBe('draft');

    // 2. Client uploads the part straight to object storage.
    await putToPresignedUrl(started.upload.parts[0].url, fixture);

    // 3. Complete twice: same state, still one processing run.
    for (let i = 0; i < 2; i++) {
      const completed = bodyOf<VideoBody>(
        await http()
          .post(`/channels/me/videos/${started.id}/upload/complete`)
          .set(auth)
          .expect(200),
      );
      expect(['processing', 'ready']).toContain(completed.status);
      expect(completed.processing_run).toBe(1);
    }

    // 4. The worker extracts metadata and the thumbnail.
    const ready = await waitFor(
      async () => {
        const res = await http()
          .get(`/channels/me/videos/${started.id}`)
          .set(auth)
          .expect(200);
        const video = bodyOf<VideoBody>(res);
        return video.status === 'ready' ? video : null;
      },
      { timeoutMs: 90_000 },
    );
    expect(ready.duration_seconds).toBeGreaterThan(2.9);
    expect(ready.has_thumbnail).toBe(true);
    expect(ready.metadata).toMatchObject({ width: 320, height: 240 });

    // 5. Anonymous lookup by the unique public id.
    const published = bodyOf<PublicVideoBody>(
      await http().get(`/videos/${started.public_id}`).expect(200),
    );
    expect(published.public_id).toBe(started.public_id);

    const thumbnail = await http()
      .get(published.thumbnail_url)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(thumbnail.headers['content-type']).toBe('image/jpeg');
    expect((thumbnail.body as Buffer).subarray(0, 3)).toEqual(
      Buffer.from([0xff, 0xd8, 0xff]),
    );

    // 6. Partial streaming and full download.
    const partial = await http()
      .get(published.stream_url)
      .set('Range', 'bytes=100-199')
      .buffer(true)
      .parse(binaryParser)
      .expect(206);
    expect(partial.headers['content-range']).toBe(
      `bytes 100-199/${fixture.length}`,
    );
    expect(partial.body as Buffer).toEqual(fixture.subarray(100, 200));

    const download = await http()
      .get(published.download_url)
      .buffer(true)
      .parse(binaryParser)
      .expect(200);
    expect(download.headers['content-disposition']).toContain('attachment;');
    expect(sha256(download.body as Buffer)).toBe(sha256(fixture));
  });
});
