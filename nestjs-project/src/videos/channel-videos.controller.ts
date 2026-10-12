import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import type { JwtPayload } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ApiErrorEnvelope } from '../common/openapi/api-error-envelope.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import {
  UploadSessionResponseDto,
  VideoUploadResponseDto,
} from './dto/upload-response.dto';
import { VideoResponseDto } from './dto/video-response.dto';
import { VideosService } from './videos.service';

const ERROR_SCHEMA = { $ref: getSchemaPath(ApiErrorEnvelope) };

/** Owner-side video management on the authenticated user's channel (TD-11). */
@ApiTags('videos')
@ApiBearerAuth('access-token')
@Controller('channels/me/videos')
export class ChannelVideosController {
  constructor(private readonly videosService: VideosService) {}

  @Post()
  @ApiOperation({
    summary: 'Start a video upload',
    description:
      "Pre-registers the video as a draft on the caller's channel and returns presigned multipart URLs. The client PUTs each part directly to object storage — the file never passes through the API.",
  })
  @ApiResponse({
    status: 201,
    description: 'Draft created; upload instructions returned',
    type: VideoUploadResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation failed (size above 10 GiB, unsupported type…)',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 404,
    description: 'The user has no channel (CHANNEL_NOT_FOUND)',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 413,
    description: 'Size above the configured limit (VIDEO_TOO_LARGE)',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 503,
    description: 'Object storage unavailable (STORAGE_UNAVAILABLE)',
    schema: ERROR_SCHEMA,
  })
  async startUpload(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateVideoDto,
  ): Promise<VideoUploadResponseDto> {
    return this.videosService.startUpload(user.sub, dto);
  }

  @Get(':id/upload')
  @ApiOperation({
    summary: 'Resume an upload',
    description:
      'Lists the parts already stored and returns fresh presigned URLs for the missing ones (resume after a failure or after the URLs expired).',
  })
  @ApiResponse({
    status: 200,
    description: 'Upload session state',
    type: UploadSessionResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid id', schema: ERROR_SCHEMA })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found on the caller channel (VIDEO_NOT_FOUND)',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 409,
    description: 'Video is no longer a draft (INVALID_VIDEO_STATUS)',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 410,
    description: 'Upload session expired (UPLOAD_EXPIRED)',
    schema: ERROR_SCHEMA,
  })
  async getUploadSession(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UploadSessionResponseDto> {
    return this.videosService.getUploadSession(user.sub, id);
  }

  @Post(':id/upload/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete an upload',
    description:
      'Verifies every part in object storage, assembles the file, moves the video to processing and publishes the processing job. Idempotent: repeating it never creates a second job.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video is processing (or already further along)',
    type: VideoResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid id', schema: ERROR_SCHEMA })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found on the caller channel (VIDEO_NOT_FOUND)',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 409,
    description:
      'Missing parts (UPLOAD_INCOMPLETE) or video failed (INVALID_VIDEO_STATUS)',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 410,
    description: 'Upload session expired (UPLOAD_EXPIRED)',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 422,
    description:
      'Assembled size differs from the declared one (UPLOAD_SIZE_MISMATCH)',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 503,
    description: 'Storage or queue unavailable; retrying is safe',
    schema: ERROR_SCHEMA,
  })
  async completeUpload(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VideoResponseDto> {
    return this.videosService.completeUpload(user.sub, id);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one of my videos',
    description:
      'Returns a video of the caller channel in any status (draft, processing, ready, failed) — used to poll processing.',
  })
  @ApiResponse({
    status: 200,
    description: 'The video',
    type: VideoResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid id', schema: ERROR_SCHEMA })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found on the caller channel (VIDEO_NOT_FOUND)',
    schema: ERROR_SCHEMA,
  })
  async findOne(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VideoResponseDto> {
    return this.videosService.findOwnedVideo(user.sub, id);
  }

  @Post(':id/reprocess')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reprocess a failed video',
    description:
      'Starts a new processing run for a failed video whose source file is still stored.',
  })
  @ApiResponse({
    status: 200,
    description: 'Video is processing again (processing_run incremented)',
    type: VideoResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Invalid id', schema: ERROR_SCHEMA })
  @ApiResponse({
    status: 401,
    description: 'Missing or invalid access token',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 404,
    description: 'Video not found on the caller channel (VIDEO_NOT_FOUND)',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 409,
    description:
      'Video is not failed (INVALID_VIDEO_STATUS) or its source is gone (VIDEO_SOURCE_MISSING)',
    schema: ERROR_SCHEMA,
  })
  @ApiResponse({
    status: 503,
    description: 'Queue unavailable (QUEUE_UNAVAILABLE)',
    schema: ERROR_SCHEMA,
  })
  async reprocess(
    @CurrentUser() user: JwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VideoResponseDto> {
    return this.videosService.reprocess(user.sub, id);
  }
}
