import { InvalidVideoStatusException } from '../common/exceptions/domain.exception';
import { VideoStatus } from './video-status.enum';

/**
 * Allowed lifecycle transitions (phase-03-videos/TD-09):
 * draft → processing (upload completed) | failed (upload expired)
 * processing → ready | failed (worker outcome)
 * failed → processing (owner reprocess)
 */
export const VIDEO_STATUS_TRANSITIONS: Readonly<
  Record<VideoStatus, readonly VideoStatus[]>
> = {
  [VideoStatus.DRAFT]: [VideoStatus.PROCESSING, VideoStatus.FAILED],
  [VideoStatus.PROCESSING]: [VideoStatus.READY, VideoStatus.FAILED],
  [VideoStatus.READY]: [],
  [VideoStatus.FAILED]: [VideoStatus.PROCESSING],
};

export function canTransition(from: VideoStatus, to: VideoStatus): boolean {
  return VIDEO_STATUS_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: VideoStatus, to: VideoStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidVideoStatusException(from, to);
  }
}
