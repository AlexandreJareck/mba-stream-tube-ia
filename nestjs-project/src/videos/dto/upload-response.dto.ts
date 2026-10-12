import { ApiProperty } from '@nestjs/swagger';
import { VideoStatus } from '../video-status.enum';

export class UploadPartUrlDto {
  @ApiProperty({ example: 1 })
  part_number: number;

  @ApiProperty({
    description: 'Presigned S3 UploadPart URL; PUT the part bytes here.',
    example:
      'http://localhost:9000/streamtube-videos/videos/…/source?partNumber=1&uploadId=…&X-Amz-Signature=…',
  })
  url: string;
}

export class UploadedPartDto {
  @ApiProperty({ example: 1 })
  part_number: number;

  @ApiProperty({ example: 67108864 })
  size: number;
}

export class UploadInstructionsDto {
  @ApiProperty({
    description: 'Every part except the last has exactly this size.',
    example: 67108864,
  })
  part_size: number;

  @ApiProperty({ example: 160 })
  part_count: number;

  @ApiProperty({
    description: 'End of the upload session; afterwards the draft expires.',
    format: 'date-time',
  })
  expires_at: string;

  @ApiProperty({
    description: 'Expiry of the URLs in `parts` (renew via GET …/upload).',
    format: 'date-time',
  })
  url_expires_at: string;

  @ApiProperty({ type: [UploadPartUrlDto] })
  parts: UploadPartUrlDto[];
}

export class VideoUploadResponseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: 'dQw4w9WgXcQ' })
  public_id: string;

  @ApiProperty({ enum: VideoStatus, example: VideoStatus.DRAFT })
  status: VideoStatus;

  @ApiProperty({ type: UploadInstructionsDto })
  upload: UploadInstructionsDto;
}

export class UploadSessionResponseDto {
  @ApiProperty({ example: 67108864 })
  part_size: number;

  @ApiProperty({ example: 160 })
  part_count: number;

  @ApiProperty({ format: 'date-time' })
  expires_at: string;

  @ApiProperty({ format: 'date-time' })
  url_expires_at: string;

  @ApiProperty({
    type: [UploadedPartDto],
    description: 'Parts already stored (from ListParts).',
  })
  uploaded_parts: UploadedPartDto[];

  @ApiProperty({
    type: [UploadPartUrlDto],
    description: 'Fresh URLs for the parts still missing.',
  })
  parts: UploadPartUrlDto[];
}
