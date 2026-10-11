import { VIDEO_PROCESS_MESSAGE_VERSION } from './videos.constants';

/**
 * `video.process` message, v1 (phase-03-videos/TD-05): a claim-check carrying
 * only identifiers; the worker reloads the authoritative row from the DB.
 */
export interface VideoProcessMessage {
  version: typeof VIDEO_PROCESS_MESSAGE_VERSION;
  videoId: string;
  processingRun: number;
}

/** Deterministic job id — one job per video processing run (TD-06 revision). */
export function processingJobId(
  videoId: string,
  processingRun: number,
): string {
  return `video-process-${videoId}-${processingRun}`;
}
