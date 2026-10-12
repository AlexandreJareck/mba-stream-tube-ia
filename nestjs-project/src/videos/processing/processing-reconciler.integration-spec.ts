import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Queue, Worker } from 'bullmq';
import { DataSource, type Repository } from 'typeorm';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { VerificationToken } from '../../auth/entities/verification-token.entity';
import { Channel } from '../../channels/entities/channel.entity';
import queueConfig from '../../config/queue.config';
import videoConfig from '../../config/video.config';
import {
  cleanAllTables,
  createTestDataSource,
} from '../../test/create-test-data-source';
import {
  buildDraftVideo,
  createUserWithChannel,
} from '../../test/video-fixtures';
import { waitFor } from '../../test/wait';
import { User } from '../../users/entities/user.entity';
import { Video } from '../entities/video.entity';
import { processingJobId } from '../video-process.message';
import { VideoProcessingQueue } from '../video-processing.queue';
import { VideoStatus } from '../video-status.enum';
import { VIDEO_QUEUE } from '../videos.constants';
import { VideoQueueModule } from '../video-queue.module';
import { generatePublicId } from '../public-id.util';
import { PUBLIC_ID_GENERATOR, VideosRepository } from '../videos.repository';
import { VideoProcessingService } from './video-processing.service';
import { ProcessingReconcilerService } from './processing-reconciler.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('ProcessingReconcilerService (integration: PostgreSQL + Redis)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let queue: Queue;
  let reconciler: ProcessingReconcilerService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [queueConfig, videoConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        TypeOrmModule.forFeature([Video]),
        VideoQueueModule.register('consumer'),
      ],
      providers: [
        VideosRepository,
        { provide: PUBLIC_ID_GENERATOR, useValue: generatePublicId },
        VideoProcessingQueue,
        ProcessingReconcilerService,
        {
          provide: VideoProcessingService,
          useFactory: (repository: VideosRepository) => ({
            markFailed: (id: string, run: number, reason: string) =>
              repository.transition(
                id,
                VideoStatus.PROCESSING,
                VideoStatus.FAILED,
                {
                  expectedRun: run,
                  patch: { failure_reason: reason, failed_at: new Date() },
                },
              ),
          }),
          inject: [VideosRepository],
        },
      ],
    }).compile();
    await module.init();
    dataSource = module.get(DataSource);
    videos = dataSource.getRepository(Video);
    queue = module.get(getQueueToken(VIDEO_QUEUE.NAME));
    reconciler = module.get(ProcessingReconcilerService);
  });

  afterAll(async () => module.close());

  beforeEach(async () => {
    await queue.resume();
    await queue.obliterate({ force: true });
    await cleanAllTables(dataSource);
  });

  async function seed(run = 1): Promise<Video> {
    const { channel } = await createUserWithChannel(dataSource);
    return videos.save({
      ...buildDraftVideo(channel.id),
      public_id: randomUUID().slice(0, 11),
      status: VideoStatus.PROCESSING,
      processing_run: run,
      upload_id: null,
    });
  }

  it('should mark the matching row failed for a terminally failed job', async () => {
    const video = await seed();
    const worker = new Worker(
      VIDEO_QUEUE.NAME,
      () => Promise.reject(new Error('terminal test failure')),
      {
        connection: {
          host: process.env.REDIS_HOST ?? 'redis',
          port: Number(process.env.REDIS_PORT ?? 6379),
        },
      },
    );
    try {
      await queue.add(
        'test.failure',
        {},
        { jobId: processingJobId(video.id, 1), attempts: 1 },
      );
      await waitFor(async () => {
        const job = await queue.getJob(processingJobId(video.id, 1));
        return (await job?.getState()) === 'failed' ? true : null;
      });
      await reconciler.reconcile();
      const row = await videos.findOneByOrFail({ id: video.id });
      expect(row.status).toBe(VideoStatus.FAILED);
      expect(row.failure_reason).toBe('PROCESSING_FAILED');
      expect(row.failed_at).toBeInstanceOf(Date);
    } finally {
      await worker.close();
    }
  });

  it('should republish a missing current job and remain idempotent', async () => {
    const video = await seed();
    await queue.pause();

    expect(await reconciler.reconcile()).toBe(1);
    expect(await reconciler.reconcile()).toBe(0);

    const job = await queue.getJob(processingJobId(video.id, 1));
    expect(await job?.getState()).toBe('waiting');
    expect((await videos.findOneByOrFail({ id: video.id })).status).toBe(
      VideoStatus.PROCESSING,
    );
  });

  it('should leave an existing waiting job and its run unchanged', async () => {
    const video = await seed();
    await queue.pause();
    await module.get(VideoProcessingQueue).enqueueProcessing(video.id, 1);

    expect(await reconciler.reconcile()).toBe(0);
    expect(
      (await videos.findOneByOrFail({ id: video.id })).processing_run,
    ).toBe(1);
  });

  it('should ignore an older-run job and repair only the current run', async () => {
    const video = await seed(2);
    await queue.pause();
    await queue.add('stale', {}, { jobId: processingJobId(video.id, 1) });

    await reconciler.reconcile();

    expect(await queue.getJob(processingJobId(video.id, 1))).not.toBeNull();
    expect(await queue.getJob(processingJobId(video.id, 2))).not.toBeNull();
    const row = await videos.findOneByOrFail({ id: video.id });
    expect(row.status).toBe(VideoStatus.PROCESSING);
    expect(row.processing_run).toBe(2);
  });
});
