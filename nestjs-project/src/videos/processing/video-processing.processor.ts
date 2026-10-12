import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Inject, Logger, OnModuleInit } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { Job, UnrecoverableError } from 'bullmq';
import videoConfig from '../../config/video.config';
import type { VideoProcessMessage } from '../video-process.message';
import { VideoFailureReason } from '../video-status.enum';
import {
  VIDEO_PROCESS_MESSAGE_VERSION,
  VIDEO_QUEUE,
} from '../videos.constants';
import { InvalidMediaError } from './media-probe.service';
import { UploadSweeperService } from './upload-sweeper.service';
import { VideoProcessingService } from './video-processing.service';

/** Invalid media: never retried, and the run ends as `failed/INVALID_MEDIA`. */
export class InvalidMediaJobError extends UnrecoverableError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMediaJobError';
  }
}

/**
 * Consumer of the `video-processing` queue — registered only in the worker
 * process (phase-03-videos/TD-01, TD-04). Background context: failures are
 * logged and handed to BullMQ's retry/failed-set machinery, never swallowed.
 */
@Processor(VIDEO_QUEUE.NAME)
export class VideoProcessingProcessor
  extends WorkerHost
  implements OnModuleInit
{
  private readonly logger = new Logger(VideoProcessingProcessor.name);

  constructor(
    private readonly processing: VideoProcessingService,
    private readonly sweeper: UploadSweeperService,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {
    super();
  }

  onModuleInit(): void {
    this.worker.concurrency = this.config.workerConcurrency;
  }

  async process(job: Job): Promise<unknown> {
    switch (job.name) {
      case VIDEO_QUEUE.PROCESS_JOB:
        return this.processVideo(job as Job<VideoProcessMessage>);
      case VIDEO_QUEUE.SWEEP_JOB:
        return this.sweeper.sweep(new Date());
      default:
        throw new UnrecoverableError(`Unknown job name "${job.name}"`);
    }
  }

  private async processVideo(job: Job<VideoProcessMessage>): Promise<string> {
    const message = job.data;
    if (
      message?.version !== VIDEO_PROCESS_MESSAGE_VERSION ||
      typeof message.videoId !== 'string'
    ) {
      throw new UnrecoverableError(
        `Unsupported ${VIDEO_QUEUE.PROCESS_JOB} message version ${String(message?.version)}`,
      );
    }
    this.logger.log(
      `Processing jobId=${job.id} videoId=${message.videoId} attempt=${job.attemptsMade + 1}`,
    );
    try {
      return await this.processing.process(message);
    } catch (error) {
      if (error instanceof InvalidMediaError) {
        throw new InvalidMediaJobError(error.message);
      }
      throw error;
    }
  }

  @OnWorkerEvent('failed')
  async onFailed(job: Job | undefined, error: Error): Promise<void> {
    if (!job || job.name !== VIDEO_QUEUE.PROCESS_JOB) {
      this.logger.error(`Job ${job?.id ?? '?'} failed: ${error.message}`);
      return;
    }
    const message = job.data as VideoProcessMessage;
    const final =
      error instanceof UnrecoverableError ||
      job.attemptsMade >= (job.opts.attempts ?? 1);
    this.logger.warn(
      `Job failed jobId=${job.id} videoId=${message?.videoId} attempt=${job.attemptsMade} final=${final}: ${error.message}`,
    );
    if (!final || typeof message?.videoId !== 'string') return;

    const reason =
      error instanceof InvalidMediaJobError
        ? VideoFailureReason.INVALID_MEDIA
        : VideoFailureReason.PROCESSING_FAILED;
    try {
      const applied = await this.processing.markFailed(
        message.videoId,
        message.processingRun,
        reason,
      );
      this.logger.warn(
        `Video failed videoId=${message.videoId} run=${message.processingRun} reason=${reason} applied=${applied}`,
      );
    } catch (markError) {
      // Event handler: rethrowing would crash the worker; the job stays in the failed set.
      this.logger.error(
        `Could not mark videoId=${message.videoId} as failed: ${(markError as Error).message}`,
      );
    }
  }
}
