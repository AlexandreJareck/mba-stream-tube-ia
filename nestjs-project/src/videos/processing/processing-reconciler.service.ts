import { InjectQueue } from '@nestjs/bullmq';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Job, Queue } from 'bullmq';
import videoConfig from '../../config/video.config';
import { processingJobId } from '../video-process.message';
import { VideoProcessingQueue } from '../video-processing.queue';
import { VideoFailureReason } from '../video-status.enum';
import {
  PROCESSING_RECONCILE_BATCH_SIZE,
  VIDEO_QUEUE,
} from '../videos.constants';
import { VideosRepository } from '../videos.repository';
import { VideoProcessingService } from './video-processing.service';

const PENDING_STATES: ReadonlySet<string> = new Set([
  'active',
  'delayed',
  'prioritized',
  'waiting',
  'waiting-children',
]);

@Injectable()
export class ProcessingReconcilerService {
  private readonly logger = new Logger(ProcessingReconcilerService.name);

  constructor(
    private readonly videos: VideosRepository,
    private readonly producer: VideoProcessingQueue,
    private readonly processing: VideoProcessingService,
    @InjectQueue(VIDEO_QUEUE.NAME)
    private readonly queue: Queue,
  ) {}

  async reconcile(): Promise<number> {
    let changes = 0;
    let afterId: string | undefined;
    for (;;) {
      const videos = await this.videos.findProcessing(
        PROCESSING_RECONCILE_BATCH_SIZE,
        afterId,
      );
      for (const video of videos) {
        const jobId = processingJobId(video.id, video.processing_run);
        const job = await this.queue.getJob(jobId);
        if (!job) {
          await this.producer.enqueueProcessing(video.id, video.processing_run);
          changes += 1;
          this.logger.warn(
            `Reconciliation republished missing job videoId=${video.id} processingRun=${video.processing_run} jobId=${jobId}`,
          );
          continue;
        }

        const state = await (job as Job).getState();
        if (PENDING_STATES.has(state)) continue;
        if (state === 'failed' || state === 'completed') {
          const applied = await this.processing.markFailed(
            video.id,
            video.processing_run,
            VideoFailureReason.PROCESSING_FAILED,
          );
          if (applied) changes += 1;
          this.logger.warn(
            `Reconciliation handled terminal job videoId=${video.id} processingRun=${video.processing_run} jobId=${jobId} state=${state} applied=${applied}`,
          );
          continue;
        }
        this.logger.warn(
          `Reconciliation left unknown state unchanged videoId=${video.id} processingRun=${video.processing_run} jobId=${jobId} state=${state}`,
        );
      }
      if (videos.length < PROCESSING_RECONCILE_BATCH_SIZE) break;
      afterId = videos.at(-1)?.id;
    }
    return changes;
  }
}

@Injectable()
export class ProcessingReconcileScheduler implements OnApplicationBootstrap {
  constructor(
    @InjectQueue(VIDEO_QUEUE.NAME) private readonly queue: Queue,
    @Inject(videoConfig.KEY)
    private readonly config: ConfigType<typeof videoConfig>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.upsertJobScheduler(
      VIDEO_QUEUE.RECONCILE_SCHEDULER_ID,
      { every: this.config.processingReconcileIntervalMs },
      {
        name: VIDEO_QUEUE.RECONCILE_JOB,
        data: { version: 1 },
        opts: { removeOnComplete: { count: 10 }, removeOnFail: { count: 50 } },
      },
    );
  }
}
