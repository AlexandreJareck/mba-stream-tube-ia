/**
 * `attachment` Content-Disposition with an ASCII fallback `filename` and the
 * RFC 6266/8187 `filename*` for the original (possibly non-ASCII) name.
 */
export function attachmentDisposition(filename: string): string {
  const ascii =
    filename
      .normalize('NFKD')
      .replace(/[^\x20-\x7e]/g, '')
      .replace(/["\\/]/g, '_')
      .trim() || 'video';
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
