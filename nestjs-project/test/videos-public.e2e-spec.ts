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

interface PublicVideoBody {
  public_id: string;
  title: string;
  duration_seconds: number;
  stream_url: string;
}

// Spec: nestjs-project/specs/videos-public.plan.md (SI-03.14)
describe('Public lookup and thumbnail (e2e)', () => {
  let ctx: TestApp;
  let ready: { publicId: string };
  let draft: { publicId: string };

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(ctx.dataSource);
    ctx.throttlerStorage.storage.clear();
    const { accessToken } = await registerConfirmedUser(
      ctx,
      'publisher@example.com',
    );
    const fixture = await readFile(join(__dirname, 'fixtures/sample.mp4'));
    ready = await seedReadyVideo(ctx, accessToken, fixture);
    draft = await seedDraftVideo(ctx, accessToken);
  });

  const http = () => request(ctx.app.getHttpServer());

  describe('Lookup and thumbnail', () => {
    it('anonymous-reads-ready-video', async () => {
      const res = await http().get(`/videos/${ready.publicId}`).expect(200);

      const video = bodyOf<PublicVideoBody>(res);
      expect(video.title).toBe('Ready clip');
      expect(video.duration_seconds).toBe(3);
      expect(video.stream_url).toBe(`/videos/${ready.publicId}/stream`);
    });

    it('non-ready-is-404', async () => {
      const res = await http().get(`/videos/${draft.publicId}`).expect(404);

      expect(bodyOf<ErrorBody>(res).error).toBe('VIDEO_NOT_FOUND');
    });

    it('thumbnail-is-served-as-jpeg', async () => {
      const res = await http()
        .get(`/videos/${ready.publicId}/thumbnail`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200);

      expect(res.headers['content-type']).toBe('image/jpeg');
      expect((res.body as Buffer).subarray(0, 3)).toEqual(
        Buffer.from([0xff, 0xd8, 0xff]),
      );
    });

    it('malformed-public-id-is-404', async () => {
      const res = await http().get('/videos/abc').expect(404);

      expect(bodyOf<ErrorBody>(res).error).toBe('VIDEO_NOT_FOUND');
    });
  });
});
