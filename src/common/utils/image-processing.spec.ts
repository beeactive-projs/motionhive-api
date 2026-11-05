import sharp from 'sharp';

import {
  MAX_IMAGE_EDGE,
  PRIVATE_THUMB_HEIGHT,
  PRIVATE_THUMB_WIDTH,
  isHeic,
  normaliseImage,
  privatePhotoVariants,
} from './image-processing';

jest.mock('heic-convert', () =>
  jest.fn(async () =>
    sharp({
      create: { width: 40, height: 30, channels: 3, background: '#888' },
    })
      .jpeg()
      .toBuffer(),
  ),
);

/** A photo the way a phone writes it: big, with a GPS position inside. */
async function phonePhoto(width = 4000, height = 3000): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: '#3a6' },
  })
    .withExif({
      IFD0: { Make: 'Phone', Model: 'Camera' },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '44/1 26/1 0/1' },
    })
    .jpeg()
    .toBuffer();
}

describe('normaliseImage', () => {
  it('writes the picture again without what the camera embedded', async () => {
    const input = await phonePhoto();
    expect((await sharp(input).metadata()).exif).toBeDefined();

    const out = await normaliseImage(input);
    const meta = await sharp(out.buffer).metadata();

    expect(out).toMatchObject({ contentType: 'image/jpeg', extension: 'jpg' });
    expect(meta.exif).toBeUndefined();
    expect(meta.width).toBe(MAX_IMAGE_EDGE);
    expect(meta.height).toBe(1536);
  });

  it('never enlarges a small picture', async () => {
    const out = await normaliseImage(await phonePhoto(300, 200));
    const meta = await sharp(out.buffer).metadata();
    expect([meta.width, meta.height]).toEqual([300, 200]);
  });

  it('keeps transparency as WebP', async () => {
    const png = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const out = await normaliseImage(png);
    expect(out).toMatchObject({ contentType: 'image/webp', extension: 'webp' });
    expect((await sharp(out.buffer).metadata()).hasAlpha).toBe(true);
  });

  it('keeps a GIF byte for byte, so an animation stays animated', async () => {
    const gif = await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#f00' },
    })
      .gif()
      .toBuffer();
    const out = await normaliseImage(gif);
    expect(out.buffer.equals(gif)).toBe(true);
    expect(out.extension).toBe('gif');
  });

  it('reads an iPhone HEIC through the converter', async () => {
    const heic = Buffer.concat([
      Buffer.from([0, 0, 0, 24]),
      Buffer.from('ftypheic', 'latin1'),
      Buffer.alloc(16),
    ]);
    expect(isHeic(heic)).toBe(true);
    const out = await normaliseImage(heic);
    expect(out.extension).toBe('jpg');
    expect((await sharp(out.buffer).metadata()).width).toBe(40);
  });

  it('refuses bytes that are not a picture', async () => {
    await expect(
      normaliseImage(Buffer.from('not an image at all')),
    ).rejects.toThrow();
  });
});

describe('privatePhotoVariants', () => {
  it('makes the whole photo and a 3:4 thumbnail, both without metadata', async () => {
    const { full, thumb } = await privatePhotoVariants(await phonePhoto());
    const fullMeta = await sharp(full).metadata();
    const thumbMeta = await sharp(thumb).metadata();

    expect(fullMeta.width).toBe(MAX_IMAGE_EDGE);
    expect(fullMeta.exif).toBeUndefined();
    expect([thumbMeta.width, thumbMeta.height]).toEqual([
      PRIVATE_THUMB_WIDTH,
      PRIVATE_THUMB_HEIGHT,
    ]);
    expect(thumbMeta.format).toBe('jpeg');
  });
});
