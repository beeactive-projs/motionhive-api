import convertHeic from 'heic-convert';
import sharp from 'sharp';

/**
 * What every uploaded picture becomes before it is stored. The original
 * file never reaches storage: it is turned upright, capped in size and
 * written again, which leaves behind whatever the camera embedded (the
 * EXIF block with its GPS position, XMP, IPTC). Storage then serves these
 * bytes as they are, so this is the one place that decides what a stored
 * picture can reveal.
 */
export interface ProcessedImage {
  buffer: Buffer;
  contentType: string;
  /** File extension for the storage key, without the dot. */
  extension: string;
}

/** The longest edge a stored picture keeps; the apps never show more. */
export const MAX_IMAGE_EDGE = 2048;

const JPEG_QUALITY = 82;
const WEBP_QUALITY = 85;

/**
 * A private photo's thumbnail: three across a phone at 3x is about 360px,
 * a little over keeps it crisp. 3:4, cropped to keep the subject.
 */
export const PRIVATE_THUMB_WIDTH = 480;
export const PRIVATE_THUMB_HEIGHT = 640;

/** HEIC/HEIF `ftyp` brands. AVIF is left out: sharp reads it directly. */
const HEIC_BRANDS = new Set([
  'heic',
  'heix',
  'heim',
  'heis',
  'hevc',
  'hevx',
  'hevm',
  'hevs',
  'mif1',
  'msf1',
]);

/** An iPhone photo straight off a Mac. sharp's own build cannot read it. */
export function isHeic(buf: Buffer): boolean {
  return (
    buf.length >= 12 &&
    buf.toString('latin1', 4, 8) === 'ftyp' &&
    HEIC_BRANDS.has(buf.toString('latin1', 8, 12))
  );
}

export function isGif(buf: Buffer): boolean {
  return buf.length >= 6 && buf.toString('latin1', 0, 4) === 'GIF8';
}

/**
 * A public upload (avatar, post, blog, exercise picture) as it is stored.
 *
 * - GIF is kept byte for byte, so an animation stays animated. The format
 *   has no slot for camera metadata.
 * - Anything with transparency becomes WebP, which keeps it.
 * - Everything else becomes JPEG.
 *
 * Throws on bytes that do not decode as an image; the caller has already
 * checked the magic bytes, so that means a corrupt file.
 */
export async function normaliseImage(buf: Buffer): Promise<ProcessedImage> {
  if (isGif(buf)) {
    return { buffer: buf, contentType: 'image/gif', extension: 'gif' };
  }
  let input = buf;
  if (isHeic(buf)) {
    input = await heicToJpeg(buf);
  }
  const image = sharp(input, { failOn: 'error' }).rotate().resize({
    width: MAX_IMAGE_EDGE,
    height: MAX_IMAGE_EDGE,
    fit: 'inside',
    withoutEnlargement: true,
  });
  const { hasAlpha } = await sharp(input).metadata();
  if (hasAlpha) {
    return {
      buffer: await image.webp({ quality: WEBP_QUALITY }).toBuffer(),
      contentType: 'image/webp',
      extension: 'webp',
    };
  }
  return {
    buffer: await image
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer(),
    contentType: 'image/jpeg',
    extension: 'jpg',
  };
}

/**
 * A private photo, whole and as a thumbnail, both JPEG. Storage cannot
 * resize a private file on the way out (nothing public may point at it),
 * so the thumbnail is made once, here.
 */
export async function privatePhotoVariants(
  jpeg: Buffer,
): Promise<{ full: Buffer; thumb: Buffer }> {
  const [full, thumb] = await Promise.all([
    sharp(jpeg, { failOn: 'error' })
      .rotate()
      .resize({
        width: MAX_IMAGE_EDGE,
        height: MAX_IMAGE_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer(),
    sharp(jpeg, { failOn: 'error' })
      .rotate()
      .resize({
        width: PRIVATE_THUMB_WIDTH,
        height: PRIVATE_THUMB_HEIGHT,
        fit: 'cover',
        position: sharp.strategy.attention,
      })
      .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
      .toBuffer(),
  ]);
  return { full, thumb };
}

/**
 * A private photo's two files: `<id>.jpg` and `<id>_thumb.jpg`, where `id`
 * is what the row stores (`workout_log.photo_public_id`).
 */
export function privateKey(id: string, size: 'full' | 'thumb'): string {
  if (size === 'thumb') {
    return `${id}_thumb.jpg`;
  }
  return `${id}.jpg`;
}

async function heicToJpeg(buf: Buffer): Promise<Buffer> {
  const out = await convertHeic({ buffer: buf, format: 'JPEG', quality: 0.92 });
  return Buffer.from(out);
}
