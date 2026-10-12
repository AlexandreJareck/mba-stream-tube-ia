import { ApiProperty } from '@nestjs/swagger';
import type { Video } from '../entities/video.entity';
import { VideoMetadataDto } from './video-response.dto';

/** Public view of a `ready` video, resolved by its unique public id. */
export class PublicVideoResponseDto {
  @ApiProperty({ example: 'dQw4w9WgXcQ' })
  public_id: string;

  @ApiProperty({ example: 'My first video' })
  title: string;

  @ApiProperty({ example: 12.5 })
  duration_seconds: number;

  @ApiProperty({ example: 'video/mp4' })
  content_type: string;

  @ApiProperty({ example: 10485760 })
  size_bytes: number;

  @ApiProperty({ type: VideoMetadataDto, nullable: true })
  metadata: VideoMetadataDto | null;

  @ApiProperty({ format: 'date-time' })
  created_at: Date;

  @ApiProperty({ example: '/videos/dQw4w9WgXcQ/stream' })
  stream_url: string;

  @ApiProperty({ example: '/videos/dQw4w9WgXcQ/download' })
  download_url: string;

  @ApiProperty({ example: '/videos/dQw4w9WgXcQ/thumbnail' })
  thumbnail_url: string;

  static fromEntity(video: Video): PublicVideoResponseDto {
    const base = `/videos/${video.public_id}`;
    return {
      public_id: video.public_id,
      title: video.title,
      duration_seconds: video.duration_seconds as number,
      content_type: video.content_type,
      size_bytes: video.size_bytes,
      metadata: video.metadata,
      created_at: video.created_at,
      stream_url: `${base}/stream`,
      download_url: `${base}/download`,
      thumbnail_url: `${base}/thumbnail`,
    };
  }
}
