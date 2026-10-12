import { Controller, Get, Header, Param, StreamableFile } from '@nestjs/common';
import {
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { PublicVideoResponseDto } from './dto/public-video-response.dto';
import { VideoPlaybackService } from './video-playback.service';

const ERROR_SCHEMA = { $ref: getSchemaPath(ApiErrorEnvelope) };

/**
 * Public video access by unique public id (TD-07, TD-11). Anonymous, and
 * exempt from the global throttler so players can issue many Range requests
 * (TD-10 / ICC-1).
 */
@ApiTags('videos')
@Public()
@SkipThrottle()
@Controller('videos')
export class VideosController {
  constructor(private readonly playback: VideoPlaybackService) {}

  @Get(':publicId')
  @ApiOperation({
    summary: 'Get a video by its public id',
    description:
      'Returns a ready video with its stream, download and thumbnail URLs. Videos that are not ready answer 404.',
  })
  @ApiResponse({
    status: 200,
    description: 'The video',
    type: PublicVideoResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Unknown or not ready (VIDEO_NOT_FOUND)',
    schema: ERROR_SCHEMA,
  })
  async findOne(
    @Param('publicId') publicId: string,
  ): Promise<PublicVideoResponseDto> {
    return this.playback.getPublicVideo(publicId);
  }

  @Get(':publicId/thumbnail')
  @Header('Cache-Control', 'public, max-age=300')
  @ApiOperation({
    summary: 'Get the video thumbnail',
    description: 'JPEG generated from a frame of the video during processing.',
  })
  @ApiProduces('image/jpeg')
  @ApiResponse({
    status: 200,
    description: 'JPEG image',
    content: { 'image/jpeg': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiResponse({
    status: 404,
    description: 'Unknown or not ready (VIDEO_NOT_FOUND)',
    schema: ERROR_SCHEMA,
  })
  async thumbnail(
    @Param('publicId') publicId: string,
  ): Promise<StreamableFile> {
    const image = await this.playback.openThumbnail(publicId);
    return new StreamableFile(image.body, {
      type: image.contentType,
      length: image.contentLength,
    });
  }
}
