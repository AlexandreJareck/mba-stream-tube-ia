import { randomBytes } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { cleanAllTables } from '../src/test/create-test-data-source';
import { jobsForVideo } from '../src/test/queue';
import { MiB, putToPresignedUrl } from '../src/test/storage';
import { VIDEO_QUEUE } from '../src/videos/videos.constants';
import {
  bodyOf,
  createTestApp,
  ErrorBody,
  registerConfirmedUser,
  TestApp,
  UploadSessionBody,
  VideoBody,
} from './helpers/app';

interface StartedUpload {
  id: string;
  upload: { parts: { part_number: number; url: string }[] };
}

// Spec: nestjs-project/specs/videos-upload.plan.md (SI-03.10)
describe('Upload session and completion (e2e)', () => {
  let ctx: TestApp;
  let queue: Queue;
  let token: string;
  const file = randomBytes(5 * MiB + 1024);

  beforeAll(async () => {
    process.env.VIDEO_UPLOAD_PART_SIZE_BYTES = String(5 * MiB);
    ctx = await createTestApp();
    queue = ctx.app.get<Queue>(getQueueToken(VIDEO_QUEUE.NAME));
  });

  afterAll(async () => {
    delete process.env.VIDEO_UPLOAD_PART_SIZE_BYTES;
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

  async function startUpload(): Promise<StartedUpload> {
    const res = await http()
      .post('/channels/me/videos')
      .set(auth())
      .send({
        title: 'Two parts',
        filename: 'two-parts.mp4',
        content_type: 'video/mp4',
        size_bytes: file.length,
      })
      .expect(201);
    return bodyOf<StartedUpload>(res);
  }

  const putPart = (started: StartedUpload, n: 1 | 2) =>
    putToPresignedUrl(
      started.upload.parts[n - 1].url,
      n === 1 ? file.subarray(0, 5 * MiB) : file.subarray(5 * MiB),
    );

  describe('Resume and complete', () => {
    it('resume-lists-uploaded-and-resigns-missing', async () => {
      const started = await startUpload();
      await putPart(started, 1);

      const res = await http()
        .get(`/channels/me/videos/${started.id}/upload`)
        .set(auth())
        .expect(200);

      const session = bodyOf<UploadSessionBody>(res);
      expect(session.uploaded_parts).toEqual([
        { part_number: 1, size: 5242880 },
      ]);
      expect(session.parts.map((p) => p.part_number)).toEqual([2]);
    });

    it('complete-with-missing-part-is-rejected', async () => {
      const started = await startUpload();
      await putPart(started, 1);

      const res = await http()
        .post(`/channels/me/videos/${started.id}/upload/complete`)
        .set(auth())
        .expect(409);

      expect(bodyOf<ErrorBody>(res).error).toBe('UPLOAD_INCOMPLETE');
      const [row] = await ctx.dataSource.query<{ status: string }[]>(
        'SELECT status FROM videos WHERE id = $1',
        [started.id],
      );
      expect(row.status).toBe('draft');
    });

    it('complete-moves-to-processing-and-enqueues-once', async () => {
      const started = await startUpload();
      await putPart(started, 1);
      await putPart(started, 2);

      const first = await http()
        .post(`/channels/me/videos/${started.id}/upload/complete`)
        .set(auth())
        .expect(200);
      expect(bodyOf<VideoBody>(first).status).toBe('processing');

      const jobId = `video-process-${started.id}-1`;
      const job = await queue.getJob(jobId);
      expect(job?.data).toEqual({
        version: 1,
        videoId: started.id,
        processingRun: 1,
      });

      const second = await http()
        .post(`/channels/me/videos/${started.id}/upload/complete`)
        .set(auth())
        .expect(200);
      expect(['processing', 'ready']).toContain(
        bodyOf<VideoBody>(second).status,
      );

      const jobs = await jobsForVideo(queue, started.id);
      expect(jobs.map((j) => j.id)).toEqual([jobId]);
    });

    it('non-owner-gets-404', async () => {
      const started = await startUpload();
      const { accessToken: other } = await registerConfirmedUser(
        ctx,
        'intruder@example.com',
      );

      const session = await http()
        .get(`/channels/me/videos/${started.id}/upload`)
        .set(auth(other))
        .expect(404);
      const complete = await http()
        .post(`/channels/me/videos/${started.id}/upload/complete`)
        .set(auth(other))
        .expect(404);

      expect(bodyOf<ErrorBody>(session).error).toBe('VIDEO_NOT_FOUND');
      expect(bodyOf<ErrorBody>(complete).error).toBe('VIDEO_NOT_FOUND');
    });

    it('expired-session-returns-410', async () => {
      const started = await startUpload();
      await ctx.dataSource.query(
        `UPDATE videos SET upload_expires_at = now() - interval '1 minute' WHERE id = $1`,
        [started.id],
      );

      const res = await http()
        .get(`/channels/me/videos/${started.id}/upload`)
        .set(auth())
        .expect(410);

      expect(bodyOf<ErrorBody>(res).error).toBe('UPLOAD_EXPIRED');
    });
  });
});
