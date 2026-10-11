import { generatePublicId, isValidPublicId } from './public-id.util';

describe('public id', () => {
  it('should generate 11 URL-safe base64url characters', () => {
    const id = generatePublicId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{11}$/);
  });

  it('should not repeat across many generations', () => {
    const ids = new Set(Array.from({ length: 10_000 }, generatePublicId));
    expect(ids.size).toBe(10_000);
  });

  it.each(['abcDEF12_-x', 'AAAAAAAAAAA'])('should accept %s', (value) => {
    expect(isValidPublicId(value)).toBe(true);
  });

  it.each(['abc', 'abcDEF12_-xy', 'abcDEF12+/x', '../etc/pass', ''])(
    'should reject %s',
    (value) => {
      expect(isValidPublicId(value)).toBe(false);
    },
  );
});
