import { parseRange } from './range.util';

describe('parseRange', () => {
  const size = 1000;

  it('should return none when the header is absent', () => {
    expect(parseRange(undefined, size)).toEqual({ kind: 'none' });
  });

  it('should parse a closed range', () => {
    expect(parseRange('bytes=0-99', size)).toEqual({
      kind: 'partial',
      start: 0,
      end: 99,
    });
  });

  it('should parse an open-ended range to the last byte', () => {
    expect(parseRange('bytes=900-', size)).toEqual({
      kind: 'partial',
      start: 900,
      end: 999,
    });
  });

  it('should parse a suffix range', () => {
    expect(parseRange('bytes=-200', size)).toEqual({
      kind: 'partial',
      start: 800,
      end: 999,
    });
  });

  it('should clamp a suffix larger than the representation', () => {
    expect(parseRange('bytes=-5000', size)).toEqual({
      kind: 'partial',
      start: 0,
      end: 999,
    });
  });

  it('should clamp an end beyond the last byte', () => {
    expect(parseRange('bytes=10-5000', size)).toEqual({
      kind: 'partial',
      start: 10,
      end: 999,
    });
  });

  it('should flag a start at or past the end as unsatisfiable', () => {
    expect(parseRange('bytes=1000-', size)).toEqual({ kind: 'unsatisfiable' });
    expect(parseRange('bytes=2000-3000', size)).toEqual({
      kind: 'unsatisfiable',
    });
  });

  it('should flag a zero-length suffix as unsatisfiable', () => {
    expect(parseRange('bytes=-0', size)).toEqual({ kind: 'unsatisfiable' });
  });

  it.each([
    'items=0-10',
    'bytes=abc',
    'bytes=-',
    'bytes=50-10',
    'bytes=0-10,20-30',
    'bytes 0-10',
  ])('should ignore invalid or multi-range header %s', (header) => {
    expect(parseRange(header, size)).toEqual({ kind: 'none' });
  });

  it('should support offsets above 4 GiB', () => {
    const big = 10 * 1024 ** 3;
    expect(parseRange(`bytes=${big - 10}-`, big)).toEqual({
      kind: 'partial',
      start: big - 10,
      end: big - 1,
    });
  });
});
