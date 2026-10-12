import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '../../storage/storage.service';
import { buildStorageKeys } from '../upload-plan.util';
import type { VideoProcessMessage } from '../video-process.message';
import { VideoFailureReason, VideoStatus } from '../video-status.enum';
import { THUMBNAIL_CONTENT_TYPE } from '../videos.constants';
import { VideosRepository } from '../videos.repository';
import { MediaProbeService } from './media-probe.service';

/** Lifetime of the internal URL ffprobe/ffmpeg read the source through. */
const SOURCE_URL_TTL_SECONDS = 3600;

export type ProcessingOutcome = 'ready' | 'skipped';

/**
 * Worker-side processing of one `video.process` run (phase-03-videos/TD-04,
 * TD-06): probe → thumbnail → `processing → ready`. Safe to repeat: stale or
 * duplicate deliveries are skipped and every write is idempotent.
 */
@Injectable()
export class VideoProcessingService {
  private readonly logger = new Logger(VideoProcessingService.name);

  constructor(
    private readonly videos: VideosRepository,
    private readonly storage: StorageService,
    private readonly media: MediaProbeService,
  ) {}

  async process(message: VideoProcessMessage): Promise<ProcessingOutcome> {
    const { videoId, processingRun } = message;
    const video = await this.videos.findById(videoId);
    if (
      !video ||
      video.status !== VideoStatus.PROCESSING ||
      video.processing_run !== processingRun
    ) {
      this.logger.log(
        `Skipping videoId=${videoId} run=${processingRun}: status=${video?.status ?? 'missing'} currentRun=${video?.processing_run ?? '-'}`,
      );
      return 'skipped';
    }

    const sourceUrl = await this.storage.presignInternalGet(
      video.storage_key,
      SOURCE_URL_TTL_SECONDS,
    );
    const probe = await this.media.probe(sourceUrl);

    const thumbnailKey = buildStorageKeys(video.id).thumbnail;
    const workDir = await mkdtemp(join(tmpdir(), `video-${video.id}-`));
    try {
      const thumbnailPath = join(workDir, 'thumbnail.jpg');
      await this.media.extractThumbnail(
        sourceUrl,
        probe.durationSeconds,
        thumbnailPath,
      );
      const thumbnail = await readFile(thumbnailPath);
      await this.storage.putObject(
        thumbnailKey,
        thumbnail,
        THUMBNAIL_CONTENT_TYPE,
        thumbnail.length,
      );
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }

    const applied = await this.videos.transition(
      video.id,
      VideoStatus.PROCESSING,
      VideoStatus.READY,
      {
        expectedRun: processingRun,
        patch: {
          duration_seconds: probe.durationSeconds,
          metadata: probe.metadata,
          thumbnail_key: thumbnailKey,
          processed_at: new Date(),
          failure_reason: null,
        },
      },
    );
    this.logger.log(
      `Processed videoId=${video.id} run=${processingRun} durationSeconds=${probe.durationSeconds} applied=${applied}`,
    );
    return applied ? 'ready' : 'skipped';
  }

  /** Final failure of a run: `processing → failed` with an internal code only. */
  async markFailed(
    videoId: string,
    processingRun: number,
    reason: VideoFailureReason,
  ): Promise<boolean> {
    return this.videos.transition(
      videoId,
      VideoStatus.PROCESSING,
      VideoStatus.FAILED,
      {
        expectedRun: processingRun,
        patch: { failure_reason: reason, failed_at: new Date() },
      },
    );
  }
}
