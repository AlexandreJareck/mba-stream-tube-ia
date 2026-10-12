import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { StorageService } from '../src/storage/storage.service';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { VIDEO_QUEUE } from '../src/videos/videos.constants';
import {
  bodyOf,
  createTestApp,
  ErrorBody,
  registerConfirmedUser,
  TestApp,
  VideoBody,
  VideoUploadBody,
} from './helpers/app';

// Spec: nestjs-project/specs/videos-owner.plan.md (SI-03.13)
describe('Owner video read and reprocess (e2e)', () => {
  let ctx: TestApp;
  let queue: Queue;
  let storage: StorageService;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    queue = ctx.app.get<Queue>(getQueueToken(VIDEO_QUEUE.NAME));
    storage = ctx.app.get(StorageService);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await cleanAllTables(ctx.dataSource);
    ctx.throttlerStorage.storage.clear();
    ({ accessToken: token } = await registerConfirmedUser(
      ctx,
      'owner@example.com',
    ));
  });

  const http = () => request(ctx.app.getHttpServer());
  const auth = (t = token) => ({ Authorization: `Bearer ${t}` });

  async function startUpload(): Promise<VideoUploadBody> {
    const res = await http()
      .post('/channels/me/videos')
      .set(auth())
      .send({
        title: 'Owner clip',
        filename: 'clip.mp4',
        content_type: 'video/mp4',
        size_bytes: 1024,
      })
      .expect(201);
    return bodyOf<VideoUploadBody>(res);
  }

  describe('Read and reprocess', () => {
    it('owner-reads-draft', async () => {
      const started = await startUpload();

      const res = await http()
        .get(`/channels/me/videos/${started.id}`)
        .set(auth())
        .expect(200);

      const video = bodyOf<VideoBody>(res);
      expect(video.status).toBe('draft');
      expect(video.has_thumbnail).toBe(false);
      expect(video.duration_seconds).toBeNull();
    });

    it('other-user-gets-404', async () => {
      const started = await startUpload();
      const { accessToken: other } = await registerConfirmedUser(
        ctx,
        'other@example.com',
      );

      const res = await http()
        .get(`/channels/me/videos/${started.id}`)
        .set(auth(other))
        .expect(404);

      expect(bodyOf<ErrorBody>(res).error).toBe('VIDEO_NOT_FOUND');
    });

    it('reprocess-failed-starts-new-run', async () => {
      const started = await startUpload();
      await ctx.dataSource.query(
        `UPDATE videos SET status = 'failed', processing_run = 1, upload_id = NULL,
           failure_reason = 'PROCESSING_FAILED', failed_at = now()
         WHERE id = $1`,
        [started.id],
      );
      const key = `videos/${started.id}/source`;
      await storage.putObject(key, Buffer.alloc(1024), 'video/mp4', 1024);

      const res = await http()
        .post(`/channels/me/videos/${started.id}/reprocess`)
        .set(auth())
        .expect(200);

      const video = bodyOf<VideoBody>(res);
      expect(video.status).toBe('processing');
      expect(video.processing_run).toBe(2);
      expect(video.failure_reason).toBeNull();
      const job = await queue.getJob(`video-process-${started.id}-2`);
      expect(job?.data).toEqual({
        version: 1,
        videoId: started.id,
        processingRun: 2,
      });
    });

    it('reprocess-processing-republishes-the-same-run', async () => {
      const started = await startUpload();
      await ctx.dataSource.query(
        `UPDATE videos SET status = 'processing', processing_run = 2, upload_id = NULL
         WHERE id = $1`,
        [started.id],
      );
      await storage.putObject(
        `videos/${started.id}/source`,
        Buffer.alloc(1024),
        'video/mp4',
        1024,
      );
      await queue.pause();
      try {
        const first = await http()
          .post(`/channels/me/videos/${started.id}/reprocess`)
          .set(auth())
          .expect(200);
        const second = await http()
          .post(`/channels/me/videos/${started.id}/reprocess`)
          .set(auth())
          .expect(200);

        expect(bodyOf<VideoBody>(first).processing_run).toBe(2);
        expect(bodyOf<VideoBody>(second).processing_run).toBe(2);
        expect(
          await queue.getJob(`video-process-${started.id}-2`),
        ).not.toBeNull();
      } finally {
        await queue.resume();
      }
    });

    it('reprocess-non-failed-is-409', async () => {
      const started = await startUpload();

      const res = await http()
        .post(`/channels/me/videos/${started.id}/reprocess`)
        .set(auth())
        .expect(409);

      expect(bodyOf<ErrorBody>(res).error).toBe('INVALID_VIDEO_STATUS');
    });
  });
});
