import {
  buildStorageKeys,
  expectedPartSize,
  planParts,
} from './upload-plan.util';

const MiB = 1024 * 1024;
const TEN_GIB = 10 * 1024 * MiB;

describe('upload plan', () => {
  it('should split 10 GiB into 160 parts of 64 MiB', () => {
    expect(planParts(TEN_GIB, 64 * MiB)).toEqual({
      partSize: 64 * MiB,
      partCount: 160,
    });
  });

  it('should keep a remainder in the last part', () => {
    const plan = planParts(5 * MiB + 1024, 5 * MiB);
    expect(plan.partCount).toBe(2);
    expect(expectedPartSize(1, 5 * MiB + 1024, plan)).toBe(5 * MiB);
    expect(expectedPartSize(2, 5 * MiB + 1024, plan)).toBe(1024);
  });

  it('should use a single part for files smaller than the part size', () => {
    const plan = planParts(3 * MiB, 64 * MiB);
    expect(plan.partCount).toBe(1);
    expect(expectedPartSize(1, 3 * MiB, plan)).toBe(3 * MiB);
  });

  it('should reject plans above the S3 limit of 10,000 parts', () => {
    expect(() => planParts(TEN_GIB, MiB)).toThrow(RangeError);
  });

  it.each([0, -1, 1.5])('should reject invalid size %s', (size) => {
    expect(() => planParts(size, 64 * MiB)).toThrow(RangeError);
  });

  it('should derive keys from the internal id only', () => {
    expect(buildStorageKeys('3f1c')).toEqual({
      source: 'videos/3f1c/source',
      thumbnail: 'videos/3f1c/thumbnail.jpg',
    });
  });
});
