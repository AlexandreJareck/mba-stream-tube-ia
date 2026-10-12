import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import queueConfig from '../config/queue.config';
import videoConfig from '../config/video.config';
import { jobsForVideo } from '../test/queue';
import { VideoProcessingQueue } from './video-processing.queue';
import { VideoQueueModule } from './video-queue.module';
import { VIDEO_QUEUE } from './videos.constants';

describe('VideoProcessingQueue (integration, Redis)', () => {
  let module: TestingModule;
  let producer: VideoProcessingQueue;
  let queue: Queue;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [queueConfig, videoConfig],
        }),
        VideoQueueModule.register('producer'),
      ],
      providers: [VideoProcessingQueue],
    }).compile();
    producer = module.get(VideoProcessingQueue);
    queue = module.get<Queue>(getQueueToken(VIDEO_QUEUE.NAME));
  });

  afterAll(async () => {
    await module.close();
  });

  it('should publish a v1 message with retry and retention options', async () => {
    const videoId = randomUUID();

    await producer.enqueueProcessing(videoId, 1);

    const job = await queue.getJob(`video-process-${videoId}-1`);
    expect(job?.name).toBe('video.process');
    expect(job?.data).toEqual({ version: 1, videoId, processingRun: 1 });
    expect(job?.opts.attempts).toBe(3);
    expect(job?.opts.backoff).toEqual({ type: 'exponential', delay: 10000 });
  });

  it('should not duplicate the job when the same run is published twice', async () => {
    const videoId = randomUUID();

    await producer.enqueueProcessing(videoId, 1);
    await producer.enqueueProcessing(videoId, 1);

    const jobs = await jobsForVideo(queue, videoId);
    expect(jobs).toHaveLength(1);
  });

  it('should publish a separate job for a new processing run', async () => {
    const videoId = randomUUID();

    await producer.enqueueProcessing(videoId, 1);
    await producer.enqueueProcessing(videoId, 2);

    const jobs = await jobsForVideo(queue, videoId);
    expect(jobs.map((job) => job.id).sort()).toEqual([
      `video-process-${videoId}-1`,
      `video-process-${videoId}-2`,
    ]);
  });
});
