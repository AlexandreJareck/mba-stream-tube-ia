import { Test } from '@nestjs/testing';
import { ChannelsService } from '../channels/channels.service';
import {
  ChannelNotFoundException,
  InvalidVideoStatusException,
  UploadExpiredException,
  UploadIncompleteException,
  UploadSizeMismatchException,
  VideoNotFoundException,
  VideoSourceMissingException,
  VideoTooLargeException,
} from '../common/exceptions/domain.exception';
import videoConfig from '../config/video.config';
import { StorageUploadNotFoundError } from '../storage/storage.errors';
import { StorageService } from '../storage/storage.service';
import type { CreateVideoDto } from './dto/create-video.dto';
import type { Video } from './entities/video.entity';
import { VideoStatus } from './video-status.enum';
import { VideoProcessingQueue } from './video-processing.queue';
import { VideosRepository } from './videos.repository';
import { VideosService } from './videos.service';

const MiB = 1024 * 1024;

const baseConfig = {
  maxSizeBytes: 10 * 1024 * MiB,
  uploadPartSizeBytes: 64 * MiB,
  uploadUrlTtlSeconds: 3600,
  uploadSessionTtlHours: 24,
  processingAttempts: 3,
  processingBackoffMs: 10000,
  workerConcurrency: 2,
  uploadSweepIntervalMs: 900000,
  processingReconcileIntervalMs: 60000,
};

describe('VideosService', () => {
  const videos = {
    insertDraft: jest.fn(),
    findOwned: jest.fn(),
    findById: jest.fn(),
    transition: jest.fn(),
  };
  const channels = { findByUserId: jest.fn() };
  const storage = {
    createMultipartUpload: jest.fn(),
    abortMultipartUpload: jest.fn(),
    presignUploadPart: jest.fn(),
    listParts: jest.fn(),
    completeMultipartUpload: jest.fn(),
    headObject: jest.fn(),
  };
  const queue = { enqueueProcessing: jest.fn() };

  async function buildService(config = baseConfig): Promise<VideosService> {
    const module = await Test.createTestingModule({
      providers: [
        VideosService,
        { provide: VideosRepository, useValue: videos },
        { provide: ChannelsService, useValue: channels },
        { provide: StorageService, useValue: storage },
        { provide: VideoProcessingQueue, useValue: queue },
        { provide: videoConfig.KEY, useValue: config },
      ],
    }).compile();
    return module.get(VideosService);
  }

  let service: VideosService;

  beforeEach(async () => {
    jest.resetAllMocks();
    service = await buildService();
    channels.findByUserId.mockResolvedValue({ id: 'channel-1' });
    storage.presignUploadPart.mockImplementation(
      (_key: string, _upload: string, part: number) =>
        Promise.resolve(`https://storage/part-${part}`),
    );
  });

  describe('startUpload', () => {
    const dto: CreateVideoDto = {
      title: 'Clip',
      filename: 'clip.mp4',
      content_type: 'video/mp4',
      size_bytes: 130 * MiB,
    };

    beforeEach(() => {
      storage.createMultipartUpload.mockResolvedValue('upload-1');
      videos.insertDraft.mockImplementation((data: Partial<Video>) =>
        Promise.resolve({
          ...data,
          public_id: 'abcdefghijk',
          status: VideoStatus.DRAFT,
        }),
      );
    });

    it('should create a draft with one presigned URL per 64 MiB part', async () => {
      const result = await service.startUpload('user-1', dto);

      expect(result.status).toBe(VideoStatus.DRAFT);
      expect(result.upload.part_count).toBe(3);
      expect(result.upload.part_size).toBe(64 * MiB);
      expect(result.upload.parts.map((p) => p.part_number)).toEqual([1, 2, 3]);
      expect(videos.insertDraft).toHaveBeenCalledWith(
        expect.objectContaining({
          channel_id: 'channel-1',
          upload_id: 'upload-1',
          storage_key: `videos/${result.id}/source`,
          upload_part_count: 3,
        }),
      );
    });

    it('should set the upload session to expire after the configured TTL', async () => {
      const before = Date.now();
      const result = await service.startUpload('user-1', dto);

      const ttl = new Date(result.upload.expires_at).getTime() - before;
      expect(ttl).toBeGreaterThanOrEqual(24 * 3600 * 1000 - 1000);
      expect(ttl).toBeLessThanOrEqual(24 * 3600 * 1000 + 1000);
    });

    it('should fail with CHANNEL_NOT_FOUND when the user has no channel', async () => {
      channels.findByUserId.mockResolvedValue(null);

      await expect(service.startUpload('user-1', dto)).rejects.toBeInstanceOf(
        ChannelNotFoundException,
      );
      expect(storage.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('should reject sizes above the configured limit', async () => {
      const limited = await buildService({ ...baseConfig, maxSizeBytes: MiB });

      await expect(limited.startUpload('user-1', dto)).rejects.toBeInstanceOf(
        VideoTooLargeException,
      );
    });

    it('should abort the multipart upload when the draft cannot be saved', async () => {
      const failure = new Error('db down');
      videos.insertDraft.mockRejectedValue(failure);

      await expect(service.startUpload('user-1', dto)).rejects.toBe(failure);
      expect(storage.abortMultipartUpload).toHaveBeenCalledWith(
        expect.stringMatching(/^videos\/.+\/source$/),
        'upload-1',
      );
    });
  });

  function draft(overrides: Partial<Video> = {}): Video {
    return {
      id: 'video-1',
      channel_id: 'channel-1',
      public_id: 'abcdefghijk',
      status: VideoStatus.DRAFT,
      storage_key: 'videos/video-1/source',
      upload_id: 'upload-1',
      size_bytes: 5 * MiB + 1024,
      upload_part_size: 5 * MiB,
      upload_part_count: 2,
      upload_expires_at: new Date(Date.now() + 3600 * 1000),
      processing_run: 0,
      thumbnail_key: null,
      ...overrides,
    } as Video;
  }

  const completeParts = [
    { partNumber: 1, size: 5 * MiB, etag: '"a"' },
    { partNumber: 2, size: 1024, etag: '"b"' },
  ];

  describe('getUploadSession', () => {
    it('should list stored parts and sign only the missing ones', async () => {
      videos.findOwned.mockResolvedValue(draft());
      storage.listParts.mockResolvedValue([completeParts[0]]);

      const session = await service.getUploadSession('user-1', 'video-1');

      expect(session.uploaded_parts).toEqual([
        { part_number: 1, size: 5 * MiB },
      ]);
      expect(session.parts.map((p) => p.part_number)).toEqual([2]);
    });

    it('should re-sign a part stored with an unexpected size', async () => {
      videos.findOwned.mockResolvedValue(draft());
      storage.listParts.mockResolvedValue([{ ...completeParts[0], size: 10 }]);

      const session = await service.getUploadSession('user-1', 'video-1');

      expect(session.uploaded_parts).toEqual([]);
      expect(session.parts.map((p) => p.part_number)).toEqual([1, 2]);
    });

    it('should reject an expired session', async () => {
      videos.findOwned.mockResolvedValue(
        draft({ upload_expires_at: new Date(Date.now() - 1000) }),
      );

      await expect(
        service.getUploadSession('user-1', 'video-1'),
      ).rejects.toBeInstanceOf(UploadExpiredException);
    });

    it('should treat an upload aborted in storage as expired', async () => {
      videos.findOwned.mockResolvedValue(draft());
      storage.listParts.mockRejectedValue(new StorageUploadNotFoundError('k'));

      await expect(
        service.getUploadSession('user-1', 'video-1'),
      ).rejects.toBeInstanceOf(UploadExpiredException);
    });

    it('should answer 404 for videos outside the caller channel', async () => {
      videos.findOwned.mockResolvedValue(null);

      await expect(
        service.getUploadSession('user-1', 'video-1'),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });
  });

  describe('completeUpload', () => {
    beforeEach(() => {
      storage.listParts.mockResolvedValue(completeParts);
      storage.headObject.mockResolvedValue({ size: 5 * MiB + 1024 });
      videos.transition.mockResolvedValue(true);
      videos.findById.mockResolvedValue(
        draft({ status: VideoStatus.PROCESSING, processing_run: 1 }),
      );
    });

    it('should assemble the object, move to processing and publish run 1', async () => {
      videos.findOwned.mockResolvedValue(draft());

      const result = await service.completeUpload('user-1', 'video-1');

      expect(storage.completeMultipartUpload).toHaveBeenCalledWith(
        'videos/video-1/source',
        'upload-1',
        completeParts,
      );
      expect(videos.transition).toHaveBeenCalledWith(
        'video-1',
        VideoStatus.DRAFT,
        VideoStatus.PROCESSING,
        expect.objectContaining({ incrementRun: true }),
      );
      expect(queue.enqueueProcessing).toHaveBeenCalledWith('video-1', 1);
      expect(result.status).toBe(VideoStatus.PROCESSING);
    });

    it('should re-publish the current run when already processing', async () => {
      videos.findOwned.mockResolvedValue(
        draft({ status: VideoStatus.PROCESSING, processing_run: 1 }),
      );

      await service.completeUpload('user-1', 'video-1');

      expect(storage.completeMultipartUpload).not.toHaveBeenCalled();
      expect(queue.enqueueProcessing).toHaveBeenCalledWith('video-1', 1);
    });

    it('should return a ready video untouched', async () => {
      videos.findOwned.mockResolvedValue(draft({ status: VideoStatus.READY }));

      const result = await service.completeUpload('user-1', 'video-1');

      expect(result.status).toBe(VideoStatus.READY);
      expect(queue.enqueueProcessing).not.toHaveBeenCalled();
    });

    it('should refuse to complete a failed video', async () => {
      videos.findOwned.mockResolvedValue(draft({ status: VideoStatus.FAILED }));

      await expect(
        service.completeUpload('user-1', 'video-1'),
      ).rejects.toBeInstanceOf(InvalidVideoStatusException);
    });

    it('should report missing parts as UPLOAD_INCOMPLETE', async () => {
      videos.findOwned.mockResolvedValue(draft());
      storage.listParts.mockResolvedValue([completeParts[0]]);

      await expect(
        service.completeUpload('user-1', 'video-1'),
      ).rejects.toBeInstanceOf(UploadIncompleteException);
      expect(videos.transition).not.toHaveBeenCalled();
    });

    it('should reject an assembled object of the wrong size', async () => {
      videos.findOwned.mockResolvedValue(draft());
      storage.headObject.mockResolvedValue({ size: 1 });

      await expect(
        service.completeUpload('user-1', 'video-1'),
      ).rejects.toBeInstanceOf(UploadSizeMismatchException);
      expect(queue.enqueueProcessing).not.toHaveBeenCalled();
    });

    it('should accept an upload already completed by a concurrent call', async () => {
      videos.findOwned.mockResolvedValue(draft());
      storage.listParts.mockRejectedValue(new StorageUploadNotFoundError('k'));
      videos.transition.mockResolvedValue(false);

      const result = await service.completeUpload('user-1', 'video-1');

      expect(result.status).toBe(VideoStatus.PROCESSING);
      expect(queue.enqueueProcessing).toHaveBeenCalledWith('video-1', 1);
    });
  });

  describe('reprocess', () => {
    beforeEach(() => {
      storage.headObject.mockResolvedValue({ size: 10 });
      videos.transition.mockResolvedValue(true);
      videos.findById.mockResolvedValue(
        draft({ status: VideoStatus.PROCESSING, processing_run: 2 }),
      );
    });

    it('should start a new run for a failed video and publish it', async () => {
      videos.findOwned.mockResolvedValue(
        draft({ status: VideoStatus.FAILED, processing_run: 1 }),
      );

      const result = await service.reprocess('user-1', 'video-1');

      expect(videos.transition).toHaveBeenCalledWith(
        'video-1',
        VideoStatus.FAILED,
        VideoStatus.PROCESSING,
        expect.objectContaining({ incrementRun: true }),
      );
      expect(queue.enqueueProcessing).toHaveBeenCalledWith('video-1', 2);
      expect(result.processing_run).toBe(2);
    });

    it('should republish an already-processing run without incrementing it', async () => {
      videos.findOwned.mockResolvedValue(
        draft({ status: VideoStatus.PROCESSING, processing_run: 2 }),
      );

      const result = await service.reprocess('user-1', 'video-1');

      expect(videos.transition).not.toHaveBeenCalled();
      expect(queue.enqueueProcessing).toHaveBeenCalledWith('video-1', 2);
      expect(result.processing_run).toBe(2);
    });

    it('should recover an enqueue failure by republishing the same run', async () => {
      videos.findOwned
        .mockResolvedValueOnce(
          draft({ status: VideoStatus.FAILED, processing_run: 1 }),
        )
        .mockResolvedValueOnce(
          draft({ status: VideoStatus.PROCESSING, processing_run: 2 }),
        );
      queue.enqueueProcessing
        .mockRejectedValueOnce(new Error('redis down'))
        .mockResolvedValueOnce(undefined);

      await expect(service.reprocess('user-1', 'video-1')).rejects.toThrow(
        'redis down',
      );
      await expect(
        service.reprocess('user-1', 'video-1'),
      ).resolves.toMatchObject({ processing_run: 2 });

      expect(videos.transition).toHaveBeenCalledTimes(1);
      expect(queue.enqueueProcessing).toHaveBeenNthCalledWith(1, 'video-1', 2);
      expect(queue.enqueueProcessing).toHaveBeenNthCalledWith(2, 'video-1', 2);
    });

    it('should converge after losing a concurrent failed-to-processing race', async () => {
      videos.findOwned.mockResolvedValue(
        draft({ status: VideoStatus.FAILED, processing_run: 1 }),
      );
      videos.transition.mockResolvedValue(false);

      const result = await service.reprocess('user-1', 'video-1');

      expect(result.processing_run).toBe(2);
      expect(queue.enqueueProcessing).toHaveBeenCalledWith('video-1', 2);
    });

    it('should refuse videos that are neither failed nor processing', async () => {
      videos.findOwned.mockResolvedValue(draft({ status: VideoStatus.READY }));

      await expect(
        service.reprocess('user-1', 'video-1'),
      ).rejects.toBeInstanceOf(InvalidVideoStatusException);
    });

    it('should refuse when the source object is gone', async () => {
      videos.findOwned.mockResolvedValue(draft({ status: VideoStatus.FAILED }));
      storage.headObject.mockResolvedValue(null);

      await expect(
        service.reprocess('user-1', 'video-1'),
      ).rejects.toBeInstanceOf(VideoSourceMissingException);
      expect(videos.transition).not.toHaveBeenCalled();
    });
  });
});
