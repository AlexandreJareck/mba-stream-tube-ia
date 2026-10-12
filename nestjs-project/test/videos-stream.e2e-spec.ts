import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import request from 'supertest';
import { cleanAllTables } from '../src/test/create-test-data-source';
import {
  bodyOf,
  createTestApp,
  ErrorBody,
  registerConfirmedUser,
  TestApp,
} from './helpers/app';
import { seedDraftVideo, seedReadyVideo } from './helpers/videos';

/** supertest parser that keeps binary bodies as a Buffer. */
function binary(
  res: NodeJS.ReadableStream,
  callback: (err: Error | null, body: Buffer) => void,
): void {
  const chunks: Buffer[] = [];
  res.on('data', (chunk: Buffer) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
}

const sha256 = (data: Buffer) =>
  createHash('sha256').update(data).digest('hex');

// Spec: nestjs-project/specs/videos-stream.plan.md (SI-03.15)
describe('Streaming (Range/206) and download (e2e)', () => {
  let ctx: TestApp;
  let fixture: Buffer;
  let ready: { publicId: string };
  let draft: { publicId: string };

  beforeAll(async () => {
    ctx = await createTestApp();
    fixture = await readFile(join(__dirname, 'fixtures/sample.mp4'));
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(ctx.dataSource);
    ctx.throttlerStorage.storage.clear();
    const { accessToken } = await registerConfirmedUser(
      ctx,
      'streamer@example.com',
    );
    ready = await seedReadyVideo(ctx, accessToken, fixture);
    draft = await seedDraftVideo(ctx, accessToken);
  });

  const get = (path: string) =>
    request(ctx.app.getHttpServer()).get(path).buffer(true).parse(binary);

  describe('Range streaming and download', () => {
    it('partial-range-returns-206', async () => {
      const res = await get(`/videos/${ready.publicId}/stream`)
        .set('Range', 'bytes=0-1023')
        .expect(206);

      expect(res.headers['content-range']).toBe(
        `bytes 0-1023/${fixture.length}`,
      );
      expect(res.headers['content-length']).toBe('1024');
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.body as Buffer).toEqual(fixture.subarray(0, 1024));
    });

    it('no-range-returns-full-200', async () => {
      const res = await get(`/videos/${ready.publicId}/stream`).expect(200);

      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(res.headers['content-length']).toBe(String(fixture.length));
      expect(res.headers['content-type']).toBe('video/mp4');
      expect((res.body as Buffer).length).toBe(fixture.length);
    });

    it('unsatisfiable-range-returns-416', async () => {
      const res = await request(ctx.app.getHttpServer())
        .get(`/videos/${ready.publicId}/stream`)
        .set('Range', `bytes=${fixture.length}-`)
        .expect(416);

      expect(bodyOf<ErrorBody>(res).error).toBe('RANGE_NOT_SATISFIABLE');
      expect(res.headers['content-range']).toBe(`bytes */${fixture.length}`);
    });

    it('download-is-attachment-and-intact', async () => {
      const res = await get(`/videos/${ready.publicId}/download`).expect(200);

      const disposition = res.headers['content-disposition'] as string;
      expect(disposition.startsWith('attachment;')).toBe(true);
      expect(disposition).toContain('filename="ready clip cao.mp4"');
      expect(sha256(res.body as Buffer)).toBe(sha256(fixture));
    });

    it('non-ready-stream-and-download-404', async () => {
      for (const path of ['stream', 'download']) {
        const res = await request(ctx.app.getHttpServer())
          .get(`/videos/${draft.publicId}/${path}`)
          .expect(404);
        expect(bodyOf<ErrorBody>(res).error).toBe('VIDEO_NOT_FOUND');
      }
    });
  });
});
