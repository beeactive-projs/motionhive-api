import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { apiError } from '../i18n';

/**
 * Magic-byte signature check for the image formats Cloudinary accepts
 * for inline rendering on a post. Defense-in-depth against a client that
 * spoofs `Content-Type: image/png` on a non-image payload.
 */
export function isSupportedImage(buf: Buffer): boolean {
  if (!buf || buf.length < 12) return false;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return true;
  }

  // GIF: 'GIF87a' or 'GIF89a'
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return true;
  }

  // WEBP: 'RIFF' .... 'WEBP'
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return true;
  }

  // HEIC / HEIF / AVIF: an ISO media box, '....ftyp' then the brand. An
  // iPhone photo on a Mac is usually HEIC, and Cloudinary takes it.
  if (buf.toString('latin1', 4, 8) === 'ftyp') {
    return ISO_IMAGE_BRANDS.has(buf.toString('latin1', 8, 12));
  }

  return false;
}

/** `ftyp` brands of still images: HEIC/HEIF (and their sequences) and AVIF. */
const ISO_IMAGE_BRANDS = new Set([
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
  'avif',
  'avis',
]);

/** The largest image any upload route accepts. The apps check it too. */
export const MAX_IMAGE_MB = 5;

/**
 * Multer options for every image upload route. With `fileSize` set,
 * multer stops reading at the limit, so an oversized upload never sits
 * whole in memory; checking `file.size` after the fact was too late for
 * that. Multer then throws "File too large", which the exception filter
 * words in the caller's language.
 */
export const IMAGE_UPLOAD_OPTIONS: MulterOptions = {
  limits: { fileSize: MAX_IMAGE_MB * 1024 * 1024, files: 1 },
};

/**
 * Refuses a missing file, or one whose bytes are not an image. The
 * multipart `mimetype` is whatever the client wrote, so the magic bytes
 * decide.
 */
export function assertImageFile(
  file: Express.Multer.File | undefined,
): asserts file is Express.Multer.File {
  if (!file) {
    throw new BadRequestException(apiError('common.noFile'));
  }
  if (!file.mimetype?.startsWith('image/') || !isSupportedImage(file.buffer)) {
    throw new BadRequestException(apiError('common.imageOnly'));
  }
}
