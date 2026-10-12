export type ParsedRange =
  | { kind: 'none' }
  | { kind: 'partial'; start: number; end: number }
  | { kind: 'unsatisfiable' };

const SINGLE_RANGE = /^bytes=(\d*)-(\d*)$/;

/**
 * Parses an HTTP `Range` header against a representation of `size` bytes
 * (RFC 9110 §14). Only a single byte range is honored; a missing header,
 * another unit, malformed syntax or a multi-range request are ignored
 * (`none` → serve the full representation), as the RFC allows.
 */
export function parseRange(
  header: string | undefined,
  size: number,
): ParsedRange {
  if (!header) return { kind: 'none' };

  const match = SINGLE_RANGE.exec(header.trim());
  if (!match) return { kind: 'none' };

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return { kind: 'none' };

  if (rawStart === '') {
    // Suffix range: the last N bytes.
    const suffixLength = Number(rawEnd);
    if (suffixLength === 0 || size === 0) return { kind: 'unsatisfiable' };
    return {
      kind: 'partial',
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    };
  }

  const start = Number(rawStart);
  if (rawEnd !== '' && Number(rawEnd) < start) return { kind: 'none' };
  if (start >= size) return { kind: 'unsatisfiable' };

  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  return { kind: 'partial', start, end };
}
