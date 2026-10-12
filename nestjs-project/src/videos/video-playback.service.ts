import { Injectable } from '@nestjs/common';
import {
  RangeNotSatisfiableException,
  VideoNotFoundException,
  VideoSourceMissingException,
} from '../common/exceptions/domain.exception';
import { StorageObjectNotFoundError } from '../storage/storage.errors';
import { StorageService, type ObjectStream } from '../storage/storage.service';
import { PublicVideoResponseDto } from './dto/public-video-response.dto';
import type { Video } from './entities/video.entity';
import { isValidPublicId } from './public-id.util';
import { parseRange } from './range.util';
import { THUMBNAIL_CONTENT_TYPE } from './videos.constants';
import { VideosRepository } from './videos.repository';

export interface ThumbnailStream extends ObjectStream {
  contentType: string;
}

export interface VideoSourceStream extends ObjectStream {
  status: 200 | 206;
  contentType: string;
  /** `bytes start-end/size` for 206 responses. */
  contentRange?: string;
  originalFilename: string;
}

/**
 * Public, read-only access to `ready` videos by public id (TD-07, TD-11).
 * Anything that is not ready is indistinguishable from a missing video.
 */
@Injectable()
export class VideoPlaybackService {
  constructor(
    private readonly videos: VideosRepository,
    private readonly storage: StorageService,
  ) {}

  async getPublicVideo(publicId: string): Promise<PublicVideoResponseDto> {
    return PublicVideoResponseDto.fromEntity(await this.findReady(publicId));
  }

  async openThumbnail(publicId: string): Promise<ThumbnailStream> {
    const video = await this.findReady(publicId);
    if (!video.thumbnail_key) {
      throw new VideoNotFoundException();
    }
    const stream = await this.openObject(video.thumbnail_key);
    return { ...stream, contentType: THUMBNAIL_CONTENT_TYPE };
  }

  /**
   * Streams the source honoring a single `Range` (RFC 9110, TD-08): 206 with
   * the requested slice, 200 with the whole object when there is no usable
   * range, RANGE_NOT_SATISFIABLE (416) when it lies outside the file.
   */
  async openSource(
    publicId: string,
    rangeHeader: string | undefined,
  ): Promise<VideoSourceStream> {
    const video = await this.findReady(publicId);
    const range = parseRange(rangeHeader, video.size_bytes);
    if (range.kind === 'unsatisfiable') {
      throw new RangeNotSatisfiableException(video.size_bytes);
    }
    const common = {
      contentType: video.content_type,
      originalFilename: video.original_filename,
    };
    if (range.kind === 'partial') {
      const stream = await this.openObject(video.storage_key, range);
      return {
        ...common,
        ...stream,
        status: 206,
        contentLength: range.end - range.start + 1,
        contentRange: `bytes ${range.start}-${range.end}/${video.size_bytes}`,
      };
    }
    const stream = await this.openObject(video.storage_key);
    return {
      ...common,
      ...stream,
      status: 200,
      contentLength: video.size_bytes,
    };
  }

  protected async findReady(publicId: string): Promise<Video> {
    const video = isValidPublicId(publicId)
      ? await this.videos.findReadyByPublicId(publicId)
      : null;
    if (!video) {
      throw new VideoNotFoundException();
    }
    return video;
  }

  protected async openObject(
    key: string,
    range?: { start: number; end: number },
  ): Promise<ObjectStream> {
    try {
      return await this.storage.getObjectStream(key, range);
    } catch (error) {
      if (error instanceof StorageObjectNotFoundError) {
        throw new VideoSourceMissingException(404);
      }
      throw error;
    }
  }
}
