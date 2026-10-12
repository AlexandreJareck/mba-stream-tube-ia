import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { Test } from '@nestjs/testing';
import { StorageService } from '../../storage/storage.service';
import type { Video } from '../entities/video.entity';
import { VideoFailureReason, VideoStatus } from '../video-status.enum';
import { VideosRepository } from '../videos.repository';
import { InvalidMediaError, MediaProbeService } from './media-probe.service';
import { VideoProcessingService } from './video-processing.service';

describe('VideoProcessingService', () => {
  let service: VideoProcessingService;
  const videos = { findById: jest.fn(), transition: jest.fn() };
  const storage = { presignInternalGet: jest.fn(), putObject: jest.fn() };
  const media = { probe: jest.fn(), extractThumbnail: jest.fn() };
  const message = { version: 1 as const, videoId: 'video-1', processingRun: 2 };

  const processingVideo = {
    id: 'video-1',
    status: VideoStatus.PROCESSING,
    processing_run: 2,
    storage_key: 'videos/video-1/source',
  } as Video;

  beforeEach(async () => {
    jest.resetAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        VideoProcessingService,
        { provide: VideosRepository, useValue: videos },
        { provide: StorageService, useValue: storage },
        { provide: MediaProbeService, useValue: media },
      ],
    }).compile();
    service = module.get(VideoProcessingService);

    storage.presignInternalGet.mockResolvedValue('http://minio/signed');
    media.probe.mockResolvedValue({
      durationSeconds: 3,
      metadata: { width: 320 },
    });
    videos.transition.mockResolvedValue(true);
  });

  it.each([
    ['missing', null],
    ['not processing', { ...processingVideo, status: VideoStatus.READY }],
    ['on another run', { ...processingVideo, processing_run: 3 }],
  ])('should skip a video that is %s', async (_label, video) => {
    videos.findById.mockResolvedValue(video);

    await expect(service.process(message)).resolves.toBe('skipped');
    expect(media.probe).not.toHaveBeenCalled();
    expect(videos.transition).not.toHaveBeenCalled();
  });

  it('should store the thumbnail and move the run to ready', async () => {
    videos.findById.mockResolvedValue(processingVideo);
    let thumbnailPath = '';
    media.extractThumbnail.mockImplementation(
      async (_url: string, _d: number, path: string) => {
        thumbnailPath = path;
        await writeFile(path, Buffer.from([0xff, 0xd8, 0xff]));
      },
    );

    await expect(service.process(message)).resolves.toBe('ready');

    expect(media.probe).toHaveBeenCalledWith('http://minio/signed');
    expect(storage.putObject).toHaveBeenCalledWith(
      'videos/video-1/thumbnail.jpg',
      Buffer.from([0xff, 0xd8, 0xff]),
      'image/jpeg',
      3,
    );
    expect(videos.transition).toHaveBeenCalledWith(
      'video-1',
      VideoStatus.PROCESSING,
      VideoStatus.READY,
      expect.objectContaining({
        expectedRun: 2,
        patch: expect.objectContaining({
          duration_seconds: 3,
          thumbnail_key: 'videos/video-1/thumbnail.jpg',
        }) as unknown,
      }),
    );
    expect(existsSync(thumbnailPath)).toBe(false);
  });

  it('should propagate probe failures without touching the status', async () => {
    videos.findById.mockResolvedValue(processingVideo);
    media.probe.mockRejectedValue(new InvalidMediaError('no video stream'));

    await expect(service.process(message)).rejects.toBeInstanceOf(
      InvalidMediaError,
    );
    expect(videos.transition).not.toHaveBeenCalled();
  });

  it('should remove the temp directory when thumbnail extraction fails', async () => {
    videos.findById.mockResolvedValue(processingVideo);
    let thumbnailPath = '';
    media.extractThumbnail.mockImplementation(
      (_url: string, _d: number, path: string) => {
        thumbnailPath = path;
        return Promise.reject(new Error('ffmpeg crashed'));
      },
    );

    await expect(service.process(message)).rejects.toThrow('ffmpeg crashed');
    expect(existsSync(thumbnailPath.replace(/thumbnail\.jpg$/, ''))).toBe(
      false,
    );
  });

  it('should mark the current run as failed with an internal reason', async () => {
    await service.markFailed('video-1', 2, VideoFailureReason.INVALID_MEDIA);

    expect(videos.transition).toHaveBeenCalledWith(
      'video-1',
      VideoStatus.PROCESSING,
      VideoStatus.FAILED,
      expect.objectContaining({
        expectedRun: 2,
        patch: expect.objectContaining({
          failure_reason: 'INVALID_MEDIA',
        }) as unknown,
      }),
    );
  });
});
