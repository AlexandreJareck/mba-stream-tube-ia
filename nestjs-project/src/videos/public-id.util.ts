import { randomBytes } from 'node:crypto';
import { PUBLIC_ID_LENGTH } from './videos.constants';

const PUBLIC_ID_PATTERN = new RegExp(`^[A-Za-z0-9_-]{${PUBLIC_ID_LENGTH}}$`);

/**
 * 64 random bits encoded as base64url → 11 URL-safe characters
 * (phase-03-videos/TD-07). Uniqueness is enforced by the DB constraint.
 */
export function generatePublicId(): string {
  return randomBytes(8).toString('base64url');
}

export function isValidPublicId(value: string): boolean {
  return PUBLIC_ID_PATTERN.test(value);
}
