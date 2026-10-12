import { attachmentDisposition } from './content-disposition.util';

describe('attachmentDisposition', () => {
  it('should keep a plain ASCII name', () => {
    expect(attachmentDisposition('clip.mp4')).toBe(
      `attachment; filename="clip.mp4"; filename*=UTF-8''clip.mp4`,
    );
  });

  it('should provide an ASCII fallback and an encoded UTF-8 name', () => {
    expect(attachmentDisposition('vídeo ção.mp4')).toBe(
      `attachment; filename="video cao.mp4"; filename*=UTF-8''v%C3%ADdeo%20%C3%A7%C3%A3o.mp4`,
    );
  });

  it('should neutralise quotes and path separators', () => {
    expect(attachmentDisposition('a"b/..\\c.mp4')).toMatch(
      /^attachment; filename="a_b_.._c\.mp4";/,
    );
  });

  it('should fall back to "video" when nothing ASCII remains', () => {
    expect(attachmentDisposition('視頻')).toMatch(
      /^attachment; filename="video";/,
    );
  });
});
