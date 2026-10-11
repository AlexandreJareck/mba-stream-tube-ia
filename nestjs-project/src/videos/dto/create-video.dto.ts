import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { MAX_VIDEO_SIZE_BYTES } from '../../config/env.validation';
import { ALLOWED_VIDEO_CONTENT_TYPES } from '../videos.constants';

export class CreateVideoDto {
  /** Video title shown to viewers. */
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title: string;

  /** Original file name, kept for download naming only. */
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  filename: string;

  /** MIME type of the file (mp4, quicktime, webm or matroska). */
  @IsIn(ALLOWED_VIDEO_CONTENT_TYPES)
  content_type: string;

  /** Exact file size in bytes; at most 10 GiB (10737418240). */
  @IsInt()
  @Min(1)
  @Max(MAX_VIDEO_SIZE_BYTES)
  size_bytes: number;
}
