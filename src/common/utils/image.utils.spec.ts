import { BadRequestException } from '@nestjs/common';
import {
  assertImageFile,
  IMAGE_UPLOAD_OPTIONS,
  isSupportedImage,
  MAX_IMAGE_MB,
  stripJpegMetadata,
} from './image.utils';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);

function upload(
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File {
  return {
    mimetype: 'image/jpeg',
    buffer: JPEG,
    size: JPEG.length,
    ...overrides,
  } as Express.Multer.File;
}

function messageKeyOf(fn: () => void): unknown {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return (
      (err as BadRequestException).getResponse() as { messageKey: string }
    ).messageKey;
  }
  throw new Error('expected a BadRequestException');
}

describe('assertImageFile', () => {
  it('accepts an image whose bytes match', () => {
    expect(() => assertImageFile(upload())).not.toThrow();
  });

  it('refuses a missing file', () => {
    expect(messageKeyOf(() => assertImageFile(undefined))).toBe(
      'common.noFile',
    );
  });

  it('refuses a file that is not labelled as an image', () => {
    expect(
      messageKeyOf(() =>
        assertImageFile(upload({ mimetype: 'application/pdf' })),
      ),
    ).toBe('common.imageOnly');
  });

  it('refuses a non-image relabelled as an image', () => {
    const exe = Buffer.from([
      0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00,
    ]);
    expect(
      messageKeyOf(() =>
        assertImageFile(upload({ mimetype: 'image/png', buffer: exe })),
      ),
    ).toBe('common.imageOnly');
  });
});

describe('stripJpegMetadata', () => {
  const segment = (marker: number, payload: Buffer) =>
    Buffer.concat([
      Buffer.from([
        0xff,
        marker,
        (payload.length + 2) >> 8,
        (payload.length + 2) & 0xff,
      ]),
      payload,
    ]);
  const scanData = Buffer.from([0x12, 0x34, 0xff, 0x00, 0x56]);
  const jpeg = Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from('JFIF\0\x01\x01', 'latin1')),
    segment(
      0xe1,
      Buffer.from('Exif\0\0GPSLatitude 44.43 GPSLongitude 26.10', 'latin1'),
    ),
    segment(
      0xe1,
      Buffer.from('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta/>', 'latin1'),
    ),
    segment(0xed, Buffer.from('Photoshop 3.0\0IPTC city=Bucharest', 'latin1')),
    segment(0xfe, Buffer.from('taken at home', 'latin1')),
    segment(0xe2, Buffer.from('ICC_PROFILE\0', 'latin1')),
    segment(0xdb, Buffer.alloc(65)),
    segment(0xda, Buffer.from([0x01, 0x01, 0x00, 0x00, 0x3f, 0x00])),
    scanData,
    Buffer.from([0xff, 0xd9]),
  ]);

  it('drops EXIF, GPS, XMP, IPTC and comments', () => {
    const text = stripJpegMetadata(jpeg)!.toString('latin1');
    for (const gone of ['Exif', 'GPS', 'xmpmeta', 'IPTC', 'taken at home']) {
      expect(text).not.toContain(gone);
    }
  });

  it('keeps the colour profile and every byte of the image', () => {
    const out = stripJpegMetadata(jpeg)!;
    expect(out.toString('latin1')).toContain('JFIF');
    expect(out.toString('latin1')).toContain('ICC_PROFILE');
    expect(out.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    expect(out.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
    expect(out.includes(scanData)).toBe(true);
  });

  it('refuses what is not a well-formed JPEG', () => {
    expect(stripJpegMetadata(Buffer.from('not a jpeg at all'))).toBeNull();
    expect(stripJpegMetadata(jpeg.subarray(0, 30))).toBeNull();
  });
});

describe('IMAGE_UPLOAD_OPTIONS', () => {
  it('makes multer stop reading at the image limit, one file per request', () => {
    expect(IMAGE_UPLOAD_OPTIONS.limits).toEqual({
      fileSize: MAX_IMAGE_MB * 1024 * 1024,
      files: 1,
    });
  });
});

describe('isSupportedImage', () => {
  it('accepts a JPEG header', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(isSupportedImage(buf)).toBe(true);
  });

  it('accepts a PNG header', () => {
    const buf = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
    ]);
    expect(isSupportedImage(buf)).toBe(true);
  });

  it('accepts GIF87a and GIF89a', () => {
    const gif87 = Buffer.from([
      0x47, 0x49, 0x46, 0x38, 0x37, 0x61, 0, 0, 0, 0, 0, 0,
    ]);
    const gif89 = Buffer.from([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0,
    ]);
    expect(isSupportedImage(gif87)).toBe(true);
    expect(isSupportedImage(gif89)).toBe(true);
  });

  it('accepts a WEBP container', () => {
    const buf = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(isSupportedImage(buf)).toBe(true);
  });

  it('accepts HEIC and AVIF by their ftyp brand', () => {
    const iso = (brand: string) =>
      Buffer.concat([
        Buffer.from([0, 0, 0, 0x18]),
        Buffer.from(`ftyp${brand}`, 'latin1'),
      ]);
    expect(isSupportedImage(iso('heic'))).toBe(true);
    expect(isSupportedImage(iso('mif1'))).toBe(true);
    expect(isSupportedImage(iso('avif'))).toBe(true);
    // An MP4 is the same kind of box with a video brand.
    expect(isSupportedImage(iso('isom'))).toBe(false);
  });

  it('rejects an empty buffer', () => {
    expect(isSupportedImage(Buffer.alloc(0))).toBe(false);
  });

  it('rejects a buffer that is too short', () => {
    expect(isSupportedImage(Buffer.from([0xff, 0xd8]))).toBe(false);
  });

  it('rejects a PE/EXE header (MZ) labeled as image', () => {
    const buf = Buffer.from([
      0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00,
    ]);
    expect(isSupportedImage(buf)).toBe(false);
  });

  it('rejects an SVG (text-based, XSS vector)', () => {
    const buf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(isSupportedImage(buf)).toBe(false);
  });
});
