import { ApiProperty } from '@nestjs/swagger';
import type { Video } from '../entities/video.entity';
import { VideoStatus } from '../video-status.enum';

export class VideoMetadataDto {
  @ApiProperty({ nullable: true, example: 'mov,mp4,m4a,3gp,3g2,mj2' })
  format_name: string | null;

  @ApiProperty({ nullable: true, example: 1200000 })
  bit_rate: number | null;

  @ApiProperty({ nullable: true, example: 1920 })
  width: number | null;

  @ApiProperty({ nullable: true, example: 1080 })
  height: number | null;

  @ApiProperty({ nullable: true, example: 'h264' })
  video_codec: string | null;

  @ApiProperty({ nullable: true, example: 'aac' })
  audio_codec: string | null;

  @ApiProperty({ nullable: true, example: 30 })
  frame_rate: number | null;
}

/** Owner view of a video in any status (status polling). */
export class VideoResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'dQw4w9WgXcQ' })
  public_id: string;

  @ApiProperty({ example: 'My first video' })
  title: string;

  @ApiProperty({ enum: VideoStatus })
  status: VideoStatus;

  @ApiProperty({ example: 'video/mp4' })
  content_type: string;

  @ApiProperty({ example: 10485760 })
  size_bytes: number;

  @ApiProperty({ nullable: true, example: 12.5 })
  duration_seconds: number | null;

  @ApiProperty({ type: VideoMetadataDto, nullable: true })
  metadata: VideoMetadataDto | null;

  @ApiProperty({ example: false })
  has_thumbnail: boolean;

  @ApiProperty({
    nullable: true,
    description:
      'Failure code when status is failed (INVALID_MEDIA, PROCESSING_FAILED, UPLOAD_EXPIRED).',
    example: null,
  })
  failure_reason: string | null;

  @ApiProperty({ example: 1 })
  processing_run: number;

  @ApiProperty({ format: 'date-time' })
  created_at: Date;

  @ApiProperty({ format: 'date-time' })
  updated_at: Date;

  static fromEntity(video: Video): VideoResponseDto {
    return {
      id: video.id,
      public_id: video.public_id,
      title: video.title,
      status: video.status,
      content_type: video.content_type,
      size_bytes: video.size_bytes,
      duration_seconds: video.duration_seconds,
      metadata: video.metadata,
      has_thumbnail: video.thumbnail_key !== null,
      failure_reason: video.failure_reason,
      processing_run: video.processing_run,
      created_at: video.created_at,
      updated_at: video.updated_at,
    };
  }
}
