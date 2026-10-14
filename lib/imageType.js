/**
 * Detects an image type from its first bytes ("magic numbers") instead of
 * trusting a declared content type or file extension.
 *
 * @param {Buffer|Uint8Array} buf
 * @returns {{ mime: string, ext: string }|null} null when not a supported image
 */
export function sniffImageType(buf) {
  if (!buf || buf.length < 12) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const ascii = (start, end) => b.toString('latin1', start, end);

  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return { mime: 'image/png', ext: 'png' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (ascii(0, 4) === 'GIF8') return { mime: 'image/gif', ext: 'gif' };
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (ascii(0, 2) === 'BM') return { mime: 'image/bmp', ext: 'bmp' };
  return null;
}
