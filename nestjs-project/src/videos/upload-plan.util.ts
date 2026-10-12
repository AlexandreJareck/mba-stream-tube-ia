import { S3_MAX_PARTS } from './videos.constants';

export interface PartPlan {
  partSize: number;
  partCount: number;
}

/**
 * Fixed-size multipart plan (phase-03-videos/TD-02): every part has
 * `partSize` bytes except the last one, which holds the remainder.
 */
export function planParts(sizeBytes: number, partSize: number): PartPlan {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new RangeError(`Invalid upload size: ${sizeBytes}`);
  }
  if (!Number.isSafeInteger(partSize) || partSize <= 0) {
    throw new RangeError(`Invalid part size: ${partSize}`);
  }
  const partCount = Math.ceil(sizeBytes / partSize);
  if (partCount > S3_MAX_PARTS) {
    throw new RangeError(
      `Upload would need ${partCount} parts; S3 allows at most ${S3_MAX_PARTS}`,
    );
  }
  return { partSize, partCount };
}

export function expectedPartSize(
  partNumber: number,
  sizeBytes: number,
  plan: PartPlan,
): number {
  if (partNumber < plan.partCount) return plan.partSize;
  return sizeBytes - plan.partSize * (plan.partCount - 1);
}

/** Deterministic object keys derived from the internal id, never from user input (TD-03). */
export function buildStorageKeys(videoId: string): {
  source: string;
  thumbnail: string;
} {
  return {
    source: `videos/${videoId}/source`,
    thumbnail: `videos/${videoId}/thumbnail.jpg`,
  };
}
