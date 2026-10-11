import request from 'supertest';
import { cleanAllTables } from '../src/test/create-test-data-source';
import {
  bodyOf,
  createTestApp,
  ErrorBody,
  registerConfirmedUser,
  TestApp,
  VideoUploadBody,
} from './helpers/app';

// Spec: nestjs-project/specs/videos-create.plan.md (SI-03.9)
describe('POST /channels/me/videos (e2e)', () => {
  let ctx: TestApp;
  let token: string;
  let userId: string;

  const validBody = {
    title: 'My first upload',
    filename: 'clip.mp4',
    content_type: 'video/mp4',
    size_bytes: 3 * 1024 * 1024,
  };

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(ctx.dataSource);
    ctx.throttlerStorage.storage.clear();
    ({ accessToken: token, userId } = await registerConfirmedUser(
      ctx,
      'uploader@example.com',
    ));
  });

  const post = (body: object, auth = true) => {
    const req = request(ctx.app.getHttpServer()).post('/channels/me/videos');
    if (auth) void req.set('Authorization', `Bearer ${token}`);
    return req.send(body);
  };

  describe('Start upload', () => {
    it('creates-draft-with-presigned-parts', async () => {
      const body = bodyOf<VideoUploadBody>(await post(validBody).expect(201));

      expect(body.status).toBe('draft');
      expect(body.public_id).toMatch(/^[A-Za-z0-9_-]{11}$/);
      expect(body.upload.part_count).toBe(1);
      expect(body.upload.parts).toHaveLength(1);
      expect(body.upload.parts[0].url).toMatch(/^https?:\/\/.*partNumber=1/);

      const [row] = await ctx.dataSource.query<
        { status: string; upload_id: string | null; user_id: string }[]
      >(
        `SELECT v.status, v.upload_id, c.user_id
         FROM videos v JOIN channels c ON c.id = v.channel_id
         WHERE v.id = $1`,
        [body.id],
      );
      expect(row.status).toBe('draft');
      expect(row.upload_id).not.toBeNull();
      expect(row.user_id).toBe(userId);
    });

    it('accepts-10gib-boundary-rejects-above', async () => {
      const atLimit = await post({
        ...validBody,
        size_bytes: 10737418240,
      }).expect(201);
      expect(bodyOf<VideoUploadBody>(atLimit).upload.part_count).toBe(160);

      const above = await post({
        ...validBody,
        size_bytes: 10737418241,
      }).expect(400);
      expect(bodyOf<ErrorBody>(above).error).toBe('VALIDATION_ERROR');
    });

    it('rejects-non-video-content-type', async () => {
      const res = await post({
        ...validBody,
        content_type: 'image/png',
      }).expect(400);
      expect(bodyOf<ErrorBody>(res).error).toBe('VALIDATION_ERROR');
    });

    it('requires-authentication', async () => {
      await post(validBody, false).expect(401);
    });
  });
});
