import { InvalidVideoStatusException } from '../common/exceptions/domain.exception';
import { VideoStatus } from './video-status.enum';
import { assertTransition, canTransition } from './video-status.transitions';

describe('video status transitions', () => {
  const allowed: [VideoStatus, VideoStatus][] = [
    [VideoStatus.DRAFT, VideoStatus.PROCESSING],
    [VideoStatus.DRAFT, VideoStatus.FAILED],
    [VideoStatus.PROCESSING, VideoStatus.READY],
    [VideoStatus.PROCESSING, VideoStatus.FAILED],
    [VideoStatus.FAILED, VideoStatus.PROCESSING],
  ];

  it.each(allowed)('should allow %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
    expect(() => assertTransition(from, to)).not.toThrow();
  });

  const statuses = Object.values(VideoStatus);
  const forbidden = statuses
    .flatMap((from) => statuses.map((to) => [from, to] as const))
    .filter(([from, to]) => !allowed.some(([f, t]) => f === from && t === to));

  it.each(forbidden)('should reject %s → %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
    expect(() => assertTransition(from, to)).toThrow(
      InvalidVideoStatusException,
    );
  });

  it('should treat ready as terminal', () => {
    expect(statuses.some((to) => canTransition(VideoStatus.READY, to))).toBe(
      false,
    );
  });
});
