import { randomBytes } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { VerificationToken } from '../auth/entities/verification-token.entity';
import { Channel } from '../channels/entities/channel.entity';
import { UploadIncompleteException } from '../common/exceptions/domain.exception';
import queueConfig from '../config/queue.config';
import storageConfig from '../config/storage.config';
import videoConfig from '../config/video.config';
import {
  cleanAllTables,
  createTestDataSource,
} from '../test/create-test-data-source';
import { jobsForVideo } from '../test/queue';
import {
  MiB,
  putToPresignedUrl,
  useInternalEndpointForPresignedUrls,
} from '../test/storage';
import { createUserWithChannel } from '../test/video-fixtures';
import { User } from '../users/entities/user.entity';
import { Video } from './entities/video.entity';
import { VideoStatus } from './video-status.enum';
import { VIDEO_QUEUE } from './videos.constants';
import { VideosModule } from './videos.module';
import { VideosService } from './videos.service';

const ALL_ENTITIES = [User, Channel, RefreshToken, VerificationToken, Video];

describe('VideosService (integration: PostgreSQL + MinIO + Redis)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let service: VideosService;
  let queue: Queue;
  let userId: string;

  const file = randomBytes(5 * MiB + 1024);

  beforeAll(async () => {
    useInternalEndpointForPresignedUrls();
    process.env.VIDEO_UPLOAD_PART_SIZE_BYTES = String(5 * MiB);
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [storageConfig, queueConfig, videoConfig],
        }),
        TypeOrmModule.forRoot(createTestDataSource(ALL_ENTITIES).options),
        VideosModule,
      ],
    }).compile();
    await module.init();
    dataSource = module.get(DataSource);
    service = module.get(VideosService);
    queue = module.get<Queue>(getQueueToken(VIDEO_QUEUE.NAME));
  });

  afterAll(async () => {
    delete process.env.VIDEO_UPLOAD_PART_SIZE_BYTES;
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    ({
      user: { id: userId },
    } = await createUserWithChannel(dataSource));
  });

  async function startTwoPartUpload() {
    return service.startUpload(userId, {
      title: 'Integration clip',
      filename: 'clip.mp4',
      content_type: 'video/mp4',
      size_bytes: file.length,
    });
  }

  it('should complete a real two-part upload exactly once', async () => {
    const started = await startTwoPartUpload();
    expect(started.upload.part_count).toBe(2);

    await putToPresignedUrl(
      started.upload.parts[0].url,
      file.subarray(0, 5 * MiB),
    );
    await putToPresignedUrl(
      started.upload.parts[1].url,
      file.subarray(5 * MiB),
    );

    const first = await service.completeUpload(userId, started.id);
    const second = await service.completeUpload(userId, started.id);

    expect(first.status).toBe(VideoStatus.PROCESSING);
    expect(first.processing_run).toBe(1);
    expect(second.status).toBe(VideoStatus.PROCESSING);
    const jobs = await jobsForVideo(queue, started.id);
    expect(jobs.map((job) => job.id)).toEqual([
      `video-process-${started.id}-1`,
    ]);
    const row = await dataSource
      .getRepository(Video)
      .findOneByOrFail({ id: started.id });
    expect(row.upload_id).toBeNull();
  });

  it('should keep the draft when a part is missing', async () => {
    const started = await startTwoPartUpload();
    await putToPresignedUrl(
      started.upload.parts[0].url,
      file.subarray(0, 5 * MiB),
    );

    await expect(
      service.completeUpload(userId, started.id),
    ).rejects.toBeInstanceOf(UploadIncompleteException);

    const session = await service.getUploadSession(userId, started.id);
    expect(session.uploaded_parts).toEqual([{ part_number: 1, size: 5 * MiB }]);
    expect(session.parts.map((p) => p.part_number)).toEqual([2]);
  });

  it('should converge concurrent reprocess requests on one run and job', async () => {
    const started = await startTwoPartUpload();
    await putToPresignedUrl(
      started.upload.parts[0].url,
      file.subarray(0, 5 * MiB),
    );
    await putToPresignedUrl(
      started.upload.parts[1].url,
      file.subarray(5 * MiB),
    );
    await service.completeUpload(userId, started.id);
    await dataSource.query(
      `UPDATE videos SET status = 'failed', failure_reason = 'PROCESSING_FAILED', failed_at = now()
       WHERE id = $1`,
      [started.id],
    );
    await queue.pause();
    try {
      const results = await Promise.all([
        service.reprocess(userId, started.id),
        service.reprocess(userId, started.id),
      ]);

      expect(results.map((video) => video.processing_run)).toEqual([2, 2]);
      const row = await dataSource
        .getRepository(Video)
        .findOneByOrFail({ id: started.id });
      expect(row.processing_run).toBe(2);
      expect(await jobsForVideo(queue, started.id)).toHaveLength(2);
      expect(
        await queue.getJob(`video-process-${started.id}-2`),
      ).not.toBeNull();
    } finally {
      await queue.resume();
    }
  });
});
