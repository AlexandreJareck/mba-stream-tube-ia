import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, MoreThan, QueryFailedError, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { Video } from './entities/video.entity';
import { VideoStatus } from './video-status.enum';
import { assertTransition } from './video-status.transitions';

export const PUBLIC_ID_GENERATOR = Symbol('PUBLIC_ID_GENERATOR');
export type PublicIdGenerator = () => string;

const PG_UNIQUE_VIOLATION = '23505';
const PUBLIC_ID_CONSTRAINT = 'UQ_videos_public_id';
const MAX_PUBLIC_ID_ATTEMPTS = 5;

export type NewDraftVideo = Pick<
  Video,
  | 'id'
  | 'channel_id'
  | 'title'
  | 'original_filename'
  | 'content_type'
  | 'size_bytes'
  | 'storage_key'
  | 'upload_id'
  | 'upload_part_size'
  | 'upload_part_count'
  | 'upload_expires_at'
>;

export interface TransitionOptions {
  /** Extra columns written atomically with the status change. */
  patch?: QueryDeepPartialEntity<Video>;
  /** Increment `processing_run` (every entry into `processing`, TD-06). */
  incrementRun?: boolean;
  /** Only apply when the row is still on this processing run. */
  expectedRun?: number;
}

function isPublicIdCollision(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as {
    code?: string;
    constraint?: string;
  };
  return (
    driverError.code === PG_UNIQUE_VIOLATION &&
    driverError.constraint === PUBLIC_ID_CONSTRAINT
  );
}

@Injectable()
export class VideosRepository {
  constructor(
    @InjectRepository(Video)
    private readonly repository: Repository<Video>,
    @Inject(PUBLIC_ID_GENERATOR)
    private readonly generatePublicId: PublicIdGenerator,
  ) {}

  /** Inserts a draft, regenerating the public id on a unique collision (TD-07). */
  async insertDraft(data: NewDraftVideo): Promise<Video> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.repository.save(
          this.repository.create({
            ...data,
            public_id: this.generatePublicId(),
            status: VideoStatus.DRAFT,
          }),
        );
      } catch (error) {
        if (!isPublicIdCollision(error) || attempt >= MAX_PUBLIC_ID_ATTEMPTS) {
          throw error;
        }
      }
    }
  }

  /**
   * Compare-and-set status change (TD-09): applies only while the row is in
   * `from` (and on `expectedRun`, when given). Returns whether it applied.
   */
  async transition(
    id: string,
    from: VideoStatus,
    to: VideoStatus,
    options: TransitionOptions = {},
  ): Promise<boolean> {
    assertTransition(from, to);
    const set: QueryDeepPartialEntity<Video> = { ...options.patch, status: to };
    if (options.incrementRun) {
      set.processing_run = () => 'processing_run + 1';
    }
    const query = this.repository
      .createQueryBuilder()
      .update(Video)
      .set(set)
      .where('id = :id', { id })
      .andWhere('status = :from', { from });
    if (options.expectedRun !== undefined) {
      query.andWhere('processing_run = :run', { run: options.expectedRun });
    }
    const result = await query.execute();
    return result.affected === 1;
  }

  async findById(id: string): Promise<Video | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findOwned(id: string, channelId: string): Promise<Video | null> {
    return this.repository.findOne({ where: { id, channel_id: channelId } });
  }

  async findReadyByPublicId(publicId: string): Promise<Video | null> {
    return this.repository.findOne({
      where: { public_id: publicId, status: VideoStatus.READY },
    });
  }

  async findExpiredDrafts(now: Date, limit: number): Promise<Video[]> {
    return this.repository.find({
      where: { status: VideoStatus.DRAFT, upload_expires_at: LessThan(now) },
      order: { upload_expires_at: 'ASC' },
      take: limit,
    });
  }

  async findProcessing(limit: number, afterId?: string): Promise<Video[]> {
    return this.repository.find({
      where: {
        status: VideoStatus.PROCESSING,
        ...(afterId && { id: MoreThan(afterId) }),
      },
      order: { id: 'ASC' },
      take: limit,
    });
  }
}
