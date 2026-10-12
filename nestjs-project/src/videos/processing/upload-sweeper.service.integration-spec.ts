import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { Test, TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { DataSource, Repository } from 'typeorm';
import { StorageUploadNotFoundError } from '../../storage/storage.errors';
import { StorageService } from '../../storage/storage.service';
import { cleanAllTables } from '../../test/create-test-data-source';
import {
  buildDraftVideo,
  createUserWithChannel,
} from '../../test/video-fixtures';
import { WorkerModule } from '../../worker/worker.module';
import { Video } from '../entities/video.entity';
import { VideoStatus } from '../video-status.enum';
import { VIDEO_QUEUE } from '../videos.constants';
import { UploadSweeperService } from './upload-sweeper.service';

describe('UploadSweeperService (integration: PostgreSQL + MinIO)', () => {
  let module: TestingModule;
  let dataSource: DataSource;
  let videos: Repository<Video>;
  let storage: StorageService;
  let sweeper: UploadSweeperService;
  let channelId: string;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    await module.init();
    dataSource = module.get(DataSource);
    videos = dataSource.getRepository(Video);
    storage = module.get(StorageService);
    sweeper = module.get(UploadSweeperService);
  });

  afterAll(async () => {
    await module.close();
  });

  beforeEach(async () => {
    await cleanAllTables(dataSource);
    ({
      channel: { id: channelId },
    } = await createUserWithChannel(dataSource));
  });

  async function seedDraft(expiresAt: Date): Promise<Video> {
    const draft = buildDraftVideo(channelId, { upload_expires_at: expiresAt });
    const uploadId = await storage.createMultipartUpload(
      draft.storage_key,
      'video/mp4',
    );
    return videos.save({
      ...draft,
      upload_id: uploadId,
      public_id: randomUUID().slice(0, 11),
    });
  }

  it('should expire stale drafts and abort their multipart uploads', async () => {
    const stale = await seedDraft(new Date(Date.now() - 60_000));
    const fresh = await seedDraft(new Date(Date.now() + 3_600_000));

    const expired = await sweeper.sweep(new Date());

    expect(expired).toBe(1);
    const staleRow = await videos.findOneByOrFail({ id: stale.id });
    expect(staleRow).toMatchObject({
      status: VideoStatus.FAILED,
      failure_reason: 'UPLOAD_EXPIRED',
      upload_id: null,
    });
    await expect(
      storage.listParts(stale.storage_key, stale.upload_id as string),
    ).rejects.toBeInstanceOf(StorageUploadNotFoundError);

    const freshRow = await videos.findOneByOrFail({ id: fresh.id });
    expect(freshRow.status).toBe(VideoStatus.DRAFT);
  });

  it('should be a no-op on a second pass', async () => {
    await seedDraft(new Date(Date.now() - 60_000));

    await sweeper.sweep(new Date());

    await expect(sweeper.sweep(new Date())).resolves.toBe(0);
  });

  it('should register the periodic sweep job when the worker starts', async () => {
    const queue = module.get<Queue>(getQueueToken(VIDEO_QUEUE.NAME));

    const scheduler = await queue.getJobScheduler(
      VIDEO_QUEUE.SWEEP_SCHEDULER_ID,
    );

    expect(scheduler?.name).toBe(VIDEO_QUEUE.SWEEP_JOB);
    expect(Number(scheduler?.every)).toBe(900000);
  });
});
