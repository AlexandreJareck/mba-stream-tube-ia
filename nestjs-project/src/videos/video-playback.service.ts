import { Injectable } from '@nestjs/common';
import {
  VideoNotFoundException,
  VideoSourceMissingException,
} from '../common/exceptions/domain.exception';
import { StorageObjectNotFoundError } from '../storage/storage.errors';
import { StorageService, type ObjectStream } from '../storage/storage.service';
import { PublicVideoResponseDto } from './dto/public-video-response.dto';
import type { Video } from './entities/video.entity';
import { isValidPublicId } from './public-id.util';
import { THUMBNAIL_CONTENT_TYPE } from './videos.constants';
import { VideosRepository } from './videos.repository';

export interface ThumbnailStream extends ObjectStream {
  contentType: string;
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
