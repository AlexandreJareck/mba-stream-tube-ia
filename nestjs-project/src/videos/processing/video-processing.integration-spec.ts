import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import videoConfig from '../../config/video.config';
import { StorageService } from '../../storage/storage.service';
import { cleanAllTables } from '../../test/create-test-data-source';
import {
  buildDraftVideo,
  createUserWithChannel,
} from '../../test/video-fixtures';
import { waitFor } from '../../test/wait';
import { WorkerModule } from '../../worker/worker.module';
import { Video } from '../entities/video.entity';
import { buildStorageKeys } from '../upload-plan.util';
import type { VideoProcessMessage } from '../video-process.message';
import { VideoProcessingQueue } from '../video-processing.queue';
import { VideoStatus } from '../video-status.enum';
import { VIDEO_QUEUE } from '../videos.constants';
import { VideoProcessingService } from './video-processing.service';

const FIXTURE = join(__dirname, '../../../test/fixtures/sample.mp4');

/**
 * Real pipeline: PostgreSQL + MinIO + Redis/BullMQ + FFmpeg, with the
 * WorkerModule consuming the queue in this process.
 */
describe('Video processing worker (integration)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let storage: StorageService;
  let producer: VideoProcessingQueue;
  let queue: Queue;

  beforeAll(async () => {
    process.env.VIDEO_PROCESSING_BACKOFF_MS = '100';
    module = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    await module.init();
    dataSource = module.get(DataSource);
    videos = dataSource.getRepository(Video);
    storage = module.get(StorageService);
    queue = module.get<Queue>(getQueueToken(VIDEO_QUEUE.NAME));
    producer = new VideoProcessingQueue(
      queue as Queue<VideoProcessMessage>,
      module.get(videoConfig.KEY),
    );
  });

  afterAll(async () => {
    delete process.env.VIDEO_PROCESSING_BACKOFF_MS;
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
  });

  async function seedProcessingVideo(body: Buffer): Promise<Video> {
    const { channel } = await createUserWithChannel(dataSource);
    const draft = buildDraftVideo(channel.id, { size_bytes: body.length });
    await storage.putObject(draft.storage_key, body, 'video/mp4', body.length);
    return videos.save({
      ...draft,
      public_id: randomUUID().slice(0, 11),
      status: VideoStatus.PROCESSING,
      processing_run: 1,
      upload_id: null,
    });
  }

  const reload = (id: string) => videos.findOneByOrFail({ id });

  it('should process the fixture to ready with metadata and a thumbnail', async () => {
    const video = await seedProcessingVideo(await readFile(FIXTURE));

    await producer.enqueueProcessing(video.id, 1);
    const ready = await waitFor(async () => {
      const row = await reload(video.id);
      return row.status === VideoStatus.READY ? row : null;
    });

    expect(ready.duration_seconds).toBeGreaterThanOrEqual(2.9);
    expect(ready.duration_seconds).toBeLessThanOrEqual(3.1);
    expect(ready.metadata).toMatchObject({ width: 320, video_codec: 'h264' });
    expect(ready.thumbnail_key).toBe(buildStorageKeys(video.id).thumbnail);
    const thumbnail = await storage.headObject(ready.thumbnail_key as string);
    expect(thumbnail?.contentType).toBe('image/jpeg');
    expect(thumbnail?.size).toBeGreaterThan(0);
  });

  it('should fail invalid media once, without retries', async () => {
    const video = await seedProcessingVideo(
      Buffer.from('not a video at all\n'.repeat(500)),
    );

    await producer.enqueueProcessing(video.id, 1);
    const failed = await waitFor(async () => {
      const row = await reload(video.id);
      return row.status === VideoStatus.FAILED ? row : null;
    });

    expect(failed.failure_reason).toBe('INVALID_MEDIA');
    expect(failed.failed_at).toBeInstanceOf(Date);
    const job = await queue.getJob(`video-process-${video.id}-1`);
    expect(await job?.getState()).toBe('failed');
    expect(job?.attemptsMade).toBe(1);
  });

  it('should leave a ready video untouched when the job is redelivered', async () => {
    const video = await seedProcessingVideo(await readFile(FIXTURE));
    await producer.enqueueProcessing(video.id, 1);
    const ready = await waitFor(async () => {
      const row = await reload(video.id);
      return row.status === VideoStatus.READY ? row : null;
    });

    const outcome = await module
      .get(VideoProcessingService)
      .process({ version: 1, videoId: video.id, processingRun: 1 });

    expect(outcome).toBe('skipped');
    const after = await reload(video.id);
    expect(after.updated_at).toEqual(ready.updated_at);
  });
});
