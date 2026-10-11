import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  type ValueTransformer,
} from 'typeorm';
import { Channel } from '../../channels/entities/channel.entity';
import { VideoStatus } from '../video-status.enum';

/** pg returns BIGINT as string; sizes are <= 10 GiB, well inside Number.MAX_SAFE_INTEGER. */
const bigintToNumber: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) => (value == null ? value : Number(value)),
};

export interface VideoMetadata {
  format_name: string | null;
  bit_rate: number | null;
  width: number | null;
  height: number | null;
  video_codec: string | null;
  audio_codec: string | null;
  frame_rate: number | null;
}

@Entity('videos')
@Index('IDX_videos_channel_id', ['channel_id'])
@Index('IDX_videos_status_upload_expires_at', ['status', 'upload_expires_at'])
@Check(
  'CHK_videos_size_bytes',
  '"size_bytes" > 0 AND "size_bytes" <= 10737418240',
)
export class Video {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  channel_id: string;

  @Index('UQ_videos_public_id', { unique: true })
  @Column({ type: 'varchar', length: 11 })
  public_id: string;

  @Column({ type: 'varchar', length: 100 })
  title: string;

  @Column({ type: 'enum', enum: VideoStatus, default: VideoStatus.DRAFT })
  status: VideoStatus;

  @Column({ type: 'varchar', length: 255 })
  original_filename: string;

  @Column({ type: 'varchar', length: 100 })
  content_type: string;

  @Column({ type: 'bigint', transformer: bigintToNumber })
  size_bytes: number;

  @Index('UQ_videos_storage_key', { unique: true })
  @Column({ type: 'varchar', length: 255 })
  storage_key: string;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  upload_id: string | null;

  @Column({ type: 'integer' })
  upload_part_size: number;

  @Column({ type: 'integer' })
  upload_part_count: number;

  @Column({ type: 'timestamp', nullable: true })
  upload_expires_at: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  thumbnail_key: string | null;

  @Column({ type: 'double precision', nullable: true })
  duration_seconds: number | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata: VideoMetadata | null;

  @Column({ type: 'integer', default: 0 })
  processing_run: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  failure_reason: string | null;

  @Column({ type: 'timestamp', nullable: true })
  processed_at: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  failed_at: Date | null;

  @CreateDateColumn()
  created_at: Date;

  @UpdateDateColumn()
  updated_at: Date;

  @ManyToOne(() => Channel, (channel) => channel.videos)
  @JoinColumn({ name: 'channel_id' })
  channel: Channel;
}
