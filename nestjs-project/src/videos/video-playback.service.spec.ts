import { Readable } from 'node:stream';
import { Test } from '@nestjs/testing';
import {
  RangeNotSatisfiableException,
  VideoNotFoundException,
  VideoSourceMissingException,
} from '../common/exceptions/domain.exception';
import { StorageObjectNotFoundError } from '../storage/storage.errors';
import { StorageService } from '../storage/storage.service';
import type { Video } from './entities/video.entity';
import { VideoStatus } from './video-status.enum';
import { VideoPlaybackService } from './video-playback.service';
import { VideosRepository } from './videos.repository';

describe('VideoPlaybackService', () => {
  let service: VideoPlaybackService;
  const videos = { findReadyByPublicId: jest.fn() };
  const storage = { getObjectStream: jest.fn() };

  const ready = {
    id: 'video-1',
    public_id: 'abcdefghijk',
    title: 'Clip',
    status: VideoStatus.READY,
    content_type: 'video/mp4',
    size_bytes: 1000,
    duration_seconds: 3,
    metadata: null,
    storage_key: 'videos/video-1/source',
    thumbnail_key: 'videos/video-1/thumbnail.jpg',
  } as Video;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        VideoPlaybackService,
        { provide: VideosRepository, useValue: videos },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();
    service = module.get(VideoPlaybackService);
  });

  describe('getPublicVideo', () => {
    it('should expose a ready video with its playback URLs', async () => {
      videos.findReadyByPublicId.mockResolvedValue(ready);

      const result = await service.getPublicVideo('abcdefghijk');

      expect(result).toMatchObject({
        public_id: 'abcdefghijk',
        title: 'Clip',
        stream_url: '/videos/abcdefghijk/stream',
        download_url: '/videos/abcdefghijk/download',
        thumbnail_url: '/videos/abcdefghijk/thumbnail',
      });
    });

    it('should not query the database for a malformed public id', async () => {
      await expect(service.getPublicVideo('../x')).rejects.toBeInstanceOf(
        VideoNotFoundException,
      );
      expect(videos.findReadyByPublicId).not.toHaveBeenCalled();
    });

    it('should answer not found when the video is not ready', async () => {
      videos.findReadyByPublicId.mockResolvedValue(null);

      await expect(
        service.getPublicVideo('abcdefghijk'),
      ).rejects.toBeInstanceOf(VideoNotFoundException);
    });
  });

  describe('openThumbnail', () => {
    it('should stream the thumbnail object as JPEG', async () => {
      videos.findReadyByPublicId.mockResolvedValue(ready);
      const body = Readable.from(['jpeg']);
      storage.getObjectStream.mockResolvedValue({ body, contentLength: 4 });

      const result = await service.openThumbnail('abcdefghijk');

      expect(storage.getObjectStream).toHaveBeenCalledWith(
        'videos/video-1/thumbnail.jpg',
        undefined,
      );
      expect(result).toEqual({
        body,
        contentLength: 4,
        contentType: 'image/jpeg',
      });
    });

    it('should report a missing object as VIDEO_SOURCE_MISSING', async () => {
      videos.findReadyByPublicId.mockResolvedValue(ready);
      storage.getObjectStream.mockRejectedValue(
        new StorageObjectNotFoundError('k'),
      );

      await expect(service.openThumbnail('abcdefghijk')).rejects.toBeInstanceOf(
        VideoSourceMissingException,
      );
    });
  });

  describe('openSource', () => {
    beforeEach(() => {
      videos.findReadyByPublicId.mockResolvedValue({
        ...ready,
        original_filename: 'clip.mp4',
      });
      storage.getObjectStream.mockResolvedValue({
        body: Readable.from(['x']),
        contentLength: 0,
      });
    });

    it('should stream the whole object with 200 when there is no Range', async () => {
      const result = await service.openSource('abcdefghijk', undefined);

      expect(storage.getObjectStream).toHaveBeenCalledWith(
        'videos/video-1/source',
        undefined,
      );
      expect(result).toMatchObject({
        status: 200,
        contentLength: 1000,
        contentType: 'video/mp4',
        originalFilename: 'clip.mp4',
      });
      expect(result.contentRange).toBeUndefined();
    });

    it('should stream only the requested slice with 206', async () => {
      const result = await service.openSource('abcdefghijk', 'bytes=100-199');

      expect(storage.getObjectStream).toHaveBeenCalledWith(
        'videos/video-1/source',
        { kind: 'partial', start: 100, end: 199 },
      );
      expect(result).toMatchObject({
        status: 206,
        contentLength: 100,
        contentRange: 'bytes 100-199/1000',
      });
    });

    it('should reject a range beyond the file with its size', async () => {
      const error = await service
        .openSource('abcdefghijk', 'bytes=1000-')
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(RangeNotSatisfiableException);
      expect((error as RangeNotSatisfiableException).sizeBytes).toBe(1000);
      expect(storage.getObjectStream).not.toHaveBeenCalled();
    });

    it('should report a missing source object as VIDEO_SOURCE_MISSING', async () => {
      storage.getObjectStream.mockRejectedValue(
        new StorageObjectNotFoundError('k'),
      );

      await expect(
        service.openSource('abcdefghijk', undefined),
      ).rejects.toBeInstanceOf(VideoSourceMissingException);
    });
  });
});
