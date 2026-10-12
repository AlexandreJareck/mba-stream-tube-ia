import {
  Controller,
  Get,
  Header,
  Headers,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { attachmentDisposition } from './content-disposition.util';
import { PublicVideoResponseDto } from './dto/public-video-response.dto';
import {
  VideoPlaybackService,
  type VideoSourceStream,
} from './video-playback.service';

const RANGE_HEADER_DOC = {
  name: 'Range',
  required: false,
  description:
    'Single byte range per RFC 9110, e.g. `bytes=0-1048575`, `bytes=1000-` or `bytes=-500`. Invalid or multi-range values are ignored (full 200 response).',
};
const VIDEO_BINARY = {
  'video/*': { schema: { type: 'string', format: 'binary' } },
};

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

  @Get(':publicId/stream')
  @ApiOperation({
    summary: 'Stream a video',
    description:
      'Pipes the video from object storage without buffering. Honors a single byte Range so players can start before the whole file is downloaded.',
  })
  @ApiHeader(RANGE_HEADER_DOC)
  @ApiResponse({
    status: 200,
    description: 'Whole video (no or unusable Range); Accept-Ranges: bytes',
    content: VIDEO_BINARY,
  })
  @ApiResponse({
    status: 206,
    description: 'Partial content with Content-Range: bytes start-end/size',
    content: VIDEO_BINARY,
  })
  @ApiResponse({
    status: 404,
    description:
      'Unknown or not ready (VIDEO_NOT_FOUND) or source file missing (VIDEO_SOURCE_MISSING)',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 416,
    description:
      'Range outside the file (RANGE_NOT_SATISFIABLE); Content-Range: bytes */size',
    schema: ERROR_SCHEMA,
  })
  async stream(
    @Param('publicId') publicId: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const source = await this.playback.openSource(publicId, range);
    return this.send(res, source);
  }

  @Get(':publicId/download')
  @ApiOperation({
    summary: 'Download a video',
    description:
      'Same as streaming but with attachment semantics (Content-Disposition); Range is honored for resumable downloads.',
  })
  @ApiHeader(RANGE_HEADER_DOC)
  @ApiResponse({
    status: 200,
    description: 'Whole file as an attachment',
    content: VIDEO_BINARY,
  })
  @ApiResponse({
    status: 206,
    description: 'Partial content of the attachment',
    content: VIDEO_BINARY,
  })
  @ApiResponse({
    status: 404,
    description:
      'Unknown or not ready (VIDEO_NOT_FOUND) or source file missing (VIDEO_SOURCE_MISSING)',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 416,
    description: 'Range outside the file (RANGE_NOT_SATISFIABLE)',
    schema: ERROR_SCHEMA,
  })
  async download(
    @Param('publicId') publicId: string,
    @Headers('range') range: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const source = await this.playback.openSource(publicId, range);
    res.setHeader(
      'Content-Disposition',
      attachmentDisposition(source.originalFilename),
    );
    return this.send(res, source);
  }

  /** HTTP-level mapping of a playback stream (status and range headers). */
  private send(res: Response, source: VideoSourceStream): StreamableFile {
    res.status(source.status);
    res.setHeader('Accept-Ranges', 'bytes');
    if (source.contentRange) {
      res.setHeader('Content-Range', source.contentRange);
    }
    return new StreamableFile(source.body, {
      type: source.contentType,
      length: source.contentLength,
    });
  }
}
