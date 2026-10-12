import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import videoConfig from '../../config/video.config';
import { StorageService } from '../../storage/storage.service';
import { VideoFailureReason, VideoStatus } from '../video-status.enum';
import { UPLOAD_SWEEP_BATCH_SIZE, VIDEO_QUEUE } from '../videos.constants';
import { VideosRepository } from '../videos.repository';

/**
 * Closes abandoned uploads (phase-03-videos/TD-03, TD-09): aborts the
 * multipart upload (freeing orphaned parts) and moves the draft to
 * `failed/UPLOAD_EXPIRED`. Idempotent — a second pass finds nothing to do.
 */
@Injectable()
export class UploadSweeperService {
  private readonly logger = new Logger(UploadSweeperService.name);

  constructor(
    private readonly videos: VideosRepository,
    private readonly storage: StorageService,
  ) {}

  async sweep(now: Date): Promise<number> {
    let expired = 0;
    for (;;) {
      const batch = await this.videos.findExpiredDrafts(
        now,
        UPLOAD_SWEEP_BATCH_SIZE,
      );
      for (const video of batch) {
        if (video.upload_id) {
          await this.storage.abortMultipartUpload(
            video.storage_key,
            video.upload_id,
          );
        }
        const applied = await this.videos.transition(
          video.id,
          VideoStatus.DRAFT,
          VideoStatus.FAILED,
          {
            patch: {
              failure_reason: VideoFailureReason.UPLOAD_EXPIRED,
              upload_id: null,
              failed_at: now,
            },
          },
        );
        if (applied) {
          expired += 1;
          this.logger.log(`Upload expired videoId=${video.id}`);
        }
      }
      if (batch.length < UPLOAD_SWEEP_BATCH_SIZE) break;
    }
    return expired;
  }
}

/** Registers the periodic `uploads.sweep` job when the worker starts. */
@Injectable()
export class UploadSweepScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(VIDEO_QUEUE.NAME) private readonly queue: Queue,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      VIDEO_QUEUE.SWEEP_SCHEDULER_ID,
      { every: this.config.uploadSweepIntervalMs },
      {
        name: VIDEO_QUEUE.SWEEP_JOB,
        data: { version: 1 },
        opts: { removeOnComplete: { count: 10 }, removeOnFail: { count: 50 } },
      },
    );
  }
}
