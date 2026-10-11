import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { QueueUnavailableException } from '../common/exceptions/domain.exception';
import videoConfig from '../config/video.config';
import {
  processingJobId,
  type VideoProcessMessage,
} from './video-process.message';
import {
  COMPLETED_JOB_RETENTION_SECONDS,
  FAILED_JOB_RETENTION_SECONDS,
  VIDEO_PROCESS_MESSAGE_VERSION,
  VIDEO_QUEUE,
} from './videos.constants';

/** Producer side of the `video-processing` queue (phase-03-videos/TD-01, TD-06). */
@Injectable()
export class VideoProcessingQueue {
  private readonly logger = new Logger(VideoProcessingQueue.name);

  constructor(
    @InjectQueue(VIDEO_QUEUE.NAME)
    private readonly queue: Queue<VideoProcessMessage>,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  /**
   * Publishes the job for one processing run. Re-publishing the same run is a
   * no-op in BullMQ because the job id already exists (deduplication).
   */
  async enqueueProcessing(
    videoId: string,
    processingRun: number,
  ): Promise<void> {
    const jobId = processingJobId(videoId, processingRun);
    try {
      await this.queue.add(
        VIDEO_QUEUE.PROCESS_JOB,
        { version: VIDEO_PROCESS_MESSAGE_VERSION, videoId, processingRun },
        {
          jobId,
          attempts: this.config.processingAttempts,
          backoff: {
            type: 'exponential',
            delay: this.config.processingBackoffMs,
          },
          removeOnComplete: { age: COMPLETED_JOB_RETENTION_SECONDS },
          removeOnFail: { age: FAILED_JOB_RETENTION_SECONDS },
        },
      );
    } catch (error) {
      this.logger.error(
        `Failed to publish ${jobId}: ${(error as Error).message}`,
      );
      throw new QueueUnavailableException();
    }
    this.logger.log(`Published ${VIDEO_QUEUE.PROCESS_JOB} jobId=${jobId}`);
  }
}
