import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
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
import { StorageService, type UploadedPart } from '../storage/storage.service';
import type { CreateVideoDto } from './dto/create-video.dto';
import type {
  UploadPartUrlDto,
  UploadSessionResponseDto,
  VideoUploadResponseDto,
} from './dto/upload-response.dto';
import { VideoResponseDto } from './dto/video-response.dto';
import type { Video } from './entities/video.entity';
import {
  buildStorageKeys,
  expectedPartSize,
  planParts,
} from './upload-plan.util';
import { VideoStatus } from './video-status.enum';
import { VideoProcessingQueue } from './video-processing.queue';
import { VideosRepository } from './videos.repository';

@Injectable()
export class VideosService {
  private readonly logger = new Logger(VideosService.name);

  constructor(
    private readonly videos: VideosRepository,
    private readonly channels: ChannelsService,
    private readonly storage: StorageService,
    private readonly processingQueue: VideoProcessingQueue,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  /**
   * Pre-registers the video as `draft` and opens a direct-to-storage multipart
   * upload (phase-03-videos/TD-02). The file bytes never reach the API.
   */
  async startUpload(
    userId: string,
    dto: CreateVideoDto,
  ): Promise<VideoUploadResponseDto> {
    const channel = await this.channels.findByUserId(userId);
    if (!channel) {
      throw new ChannelNotFoundException();
    }
    if (dto.size_bytes > this.config.maxSizeBytes) {
      throw new VideoTooLargeException(this.config.maxSizeBytes);
    }

    const plan = planParts(dto.size_bytes, this.config.uploadPartSizeBytes);
    const id = randomUUID();
    const { source } = buildStorageKeys(id);
    const uploadId = await this.storage.createMultipartUpload(
      source,
      dto.content_type,
    );

    let video: Video;
    try {
      video = await this.videos.insertDraft({
        id,
        channel_id: channel.id,
        title: dto.title,
        original_filename: dto.filename,
        content_type: dto.content_type,
        size_bytes: dto.size_bytes,
        storage_key: source,
        upload_id: uploadId,
        upload_part_size: plan.partSize,
        upload_part_count: plan.partCount,
        upload_expires_at: new Date(
          Date.now() + this.config.uploadSessionTtlHours * 3600 * 1000,
        ),
      });
    } catch (error) {
      // Compensation: no draft row means nobody can complete or sweep this upload.
      await this.storage.abortMultipartUpload(source, uploadId);
      throw error;
    }

    const partNumbers = Array.from({ length: plan.partCount }, (_, i) => i + 1);
    const parts = await this.presignParts(video, partNumbers);
    this.logger.log(
      `Upload started videoId=${video.id} channelId=${channel.id} sizeBytes=${video.size_bytes} parts=${plan.partCount}`,
    );

    return {
      id: video.id,
      public_id: video.public_id,
      status: video.status,
      upload: {
        part_size: video.upload_part_size,
        part_count: video.upload_part_count,
        expires_at: (video.upload_expires_at as Date).toISOString(),
        url_expires_at: this.urlExpiry().toISOString(),
        parts,
      },
    };
  }

  /** Resume support: lists stored parts and re-signs only the missing ones. */
  async getUploadSession(
    userId: string,
    videoId: string,
  ): Promise<UploadSessionResponseDto> {
    const video = await this.requireOwnedVideo(userId, videoId);
    this.assertOpenUploadSession(video);

    const uploaded = await this.listUploadedParts(video);
    const invalid = this.invalidPartNumbers(video, uploaded);
    return {
      part_size: video.upload_part_size,
      part_count: video.upload_part_count,
      expires_at: (video.upload_expires_at as Date).toISOString(),
      url_expires_at: this.urlExpiry().toISOString(),
      uploaded_parts: uploaded
        .filter((part) => !invalid.includes(part.partNumber))
        .map((part) => ({ part_number: part.partNumber, size: part.size })),
      parts: await this.presignParts(video, invalid),
    };
  }

  /**
   * Verifies the upload in storage, assembles the object and moves the video
   * to `processing` (TD-02, TD-06, TD-09). Idempotent: repeating the call for a
   * video already `processing` re-publishes the same run (deduplicated by job
   * id) and a `ready` video is returned unchanged.
   */
  async completeUpload(
    userId: string,
    videoId: string,
  ): Promise<VideoResponseDto> {
    const video = await this.requireOwnedVideo(userId, videoId);

    switch (video.status) {
      case VideoStatus.PROCESSING:
        await this.processingQueue.enqueueProcessing(
          video.id,
          video.processing_run,
        );
        return VideoResponseDto.fromEntity(video);
      case VideoStatus.READY:
        return VideoResponseDto.fromEntity(video);
      case VideoStatus.FAILED:
        throw new InvalidVideoStatusException(video.status);
      case VideoStatus.DRAFT:
        break;
    }

    this.assertOpenUploadSession(video);
    await this.assembleObject(video);

    const applied = await this.videos.transition(
      video.id,
      VideoStatus.DRAFT,
      VideoStatus.PROCESSING,
      {
        incrementRun: true,
        patch: { upload_id: null, upload_expires_at: null },
      },
    );
    const current = await this.requireVideo(video.id);
    if (!applied && current.status !== VideoStatus.PROCESSING) {
      // A concurrent call already moved it further (e.g. ready): nothing to do.
      return VideoResponseDto.fromEntity(current);
    }

    await this.processingQueue.enqueueProcessing(
      current.id,
      current.processing_run,
    );
    if (applied) {
      this.logger.log(
        `Upload completed videoId=${current.id} processingRun=${current.processing_run}`,
      );
    }
    return VideoResponseDto.fromEntity(current);
  }

  /** Owner view in any status (status polling). */
  async findOwnedVideo(
    userId: string,
    videoId: string,
  ): Promise<VideoResponseDto> {
    return VideoResponseDto.fromEntity(
      await this.requireOwnedVideo(userId, videoId),
    );
  }

  /**
   * Recovery path for `failed` videos (TD-09): starts a new processing run
   * when the source object is still in storage.
   */
  async reprocess(userId: string, videoId: string): Promise<VideoResponseDto> {
    const video = await this.requireOwnedVideo(userId, videoId);
    if (video.status !== VideoStatus.FAILED) {
      throw new InvalidVideoStatusException(
        video.status,
        VideoStatus.PROCESSING,
      );
    }
    if (!(await this.storage.headObject(video.storage_key))) {
      throw new VideoSourceMissingException(409);
    }

    const applied = await this.videos.transition(
      video.id,
      VideoStatus.FAILED,
      VideoStatus.PROCESSING,
      {
        incrementRun: true,
        patch: { failure_reason: null, failed_at: null, processed_at: null },
      },
    );
    const current = await this.requireVideo(video.id);
    if (!applied) {
      throw new InvalidVideoStatusException(
        current.status,
        VideoStatus.PROCESSING,
      );
    }

    await this.processingQueue.enqueueProcessing(
      current.id,
      current.processing_run,
    );
    this.logger.log(
      `Reprocess requested videoId=${current.id} processingRun=${current.processing_run}`,
    );
    return VideoResponseDto.fromEntity(current);
  }

  private async assembleObject(video: Video): Promise<void> {
    const uploadId = video.upload_id as string;
    let parts: UploadedPart[] | null;
    try {
      parts = await this.storage.listParts(video.storage_key, uploadId);
    } catch (error) {
      if (!(error instanceof StorageUploadNotFoundError)) throw error;
      // Completed by a concurrent call (or aborted): the object check decides.
      parts = null;
    }

    if (parts) {
      const invalid = this.invalidPartNumbers(video, parts);
      if (invalid.length > 0) {
        throw new UploadIncompleteException(invalid);
      }
      try {
        await this.storage.completeMultipartUpload(
          video.storage_key,
          uploadId,
          parts.filter((part) => part.partNumber <= video.upload_part_count),
        );
      } catch (error) {
        if (!(error instanceof StorageUploadNotFoundError)) throw error;
      }
    }

    const head = await this.storage.headObject(video.storage_key);
    if (!head) {
      throw new UploadExpiredException();
    }
    if (head.size !== video.size_bytes) {
      this.logger.warn(
        `Size mismatch videoId=${video.id} declared=${video.size_bytes} stored=${head.size}`,
      );
      throw new UploadSizeMismatchException();
    }
  }

  private async listUploadedParts(video: Video): Promise<UploadedPart[]> {
    try {
      return await this.storage.listParts(
        video.storage_key,
        video.upload_id as string,
      );
    } catch (error) {
      if (error instanceof StorageUploadNotFoundError) {
        throw new UploadExpiredException();
      }
      throw error;
    }
  }

  /** Part numbers 1..part_count that are missing or have an unexpected size. */
  private invalidPartNumbers(video: Video, parts: UploadedPart[]): number[] {
    const plan = {
      partSize: video.upload_part_size,
      partCount: video.upload_part_count,
    };
    const sizes = new Map(parts.map((part) => [part.partNumber, part.size]));
    const invalid: number[] = [];
    for (let n = 1; n <= plan.partCount; n++) {
      if (sizes.get(n) !== expectedPartSize(n, video.size_bytes, plan)) {
        invalid.push(n);
      }
    }
    return invalid;
  }

  private assertOpenUploadSession(video: Video): void {
    if (video.status !== VideoStatus.DRAFT || !video.upload_id) {
      throw new InvalidVideoStatusException(video.status);
    }
    if (!video.upload_expires_at || video.upload_expires_at <= new Date()) {
      throw new UploadExpiredException();
    }
  }

  /** Owner routes answer 404 for missing videos and other users' videos (TD-11). */
  private async requireOwnedVideo(
    userId: string,
    videoId: string,
  ): Promise<Video> {
    const channel = await this.channels.findByUserId(userId);
    const video = channel
      ? await this.videos.findOwned(videoId, channel.id)
      : null;
    if (!video) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  private async requireVideo(videoId: string): Promise<Video> {
    const video = await this.videos.findById(videoId);
    if (!video) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  private async presignParts(
    video: Video,
    partNumbers: number[],
  ): Promise<UploadPartUrlDto[]> {
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        part_number: partNumber,
        url: await this.storage.presignUploadPart(
          video.storage_key,
          video.upload_id as string,
          partNumber,
          this.config.uploadUrlTtlSeconds,
        ),
      })),
    );
  }

  private urlExpiry(): Date {
    return new Date(Date.now() + this.config.uploadUrlTtlSeconds * 1000);
  }
}
