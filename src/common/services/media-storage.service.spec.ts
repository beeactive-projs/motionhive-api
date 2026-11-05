import {
  BadRequestException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import sharp from 'sharp';

import { privateKey } from '../utils/image-processing';
import { MediaStorageService } from './media-storage.service';

const ENV: Record<string, string> = {
  R2_ENDPOINT: 'https://acc.eu.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'id',
  R2_SECRET_ACCESS_KEY: 'secret',
  R2_PUBLIC_BUCKET: 'pub',
  R2_PRIVATE_BUCKET: 'priv',
  MEDIA_PUBLIC_URL: 'https://img.motionhive.fit',
  NODE_ENV: 'test',
  CLOUDINARY_CLOUD_NAME: 'oldcloud',
};

function makeService(env: Record<string, string> = ENV): MediaStorageService {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return new MediaStorageService(config);
}

function file(buffer: Buffer): Express.Multer.File {
  return { buffer } as Express.Multer.File;
}

/** Every command the service sent, in order. */
let sent: unknown[];
let send: jest.Mock<Promise<unknown>, [unknown]>;

/** A stand-in for `S3Client.send`: records the command, answers `result`. */
function answer(result: unknown = {}) {
  return (command: unknown): Promise<unknown> => {
    sent.push(command);
    return Promise.resolve(result);
  };
}

/** Same, failing the way S3 does for a missing key. */
function missing() {
  return (command: unknown): Promise<unknown> => {
    sent.push(command);
    return Promise.reject(new NoSuchKey({ message: 'missing', $metadata: {} }));
  };
}

beforeEach(() => {
  sent = [];
  send = jest.spyOn(S3Client.prototype, 'send') as unknown as jest.Mock<
    Promise<unknown>,
    [unknown]
  >;
  send.mockImplementation(answer());
});

afterEach(() => jest.restoreAllMocks());

describe('MediaStorageService links', () => {
  const service = makeService();

  it('owns links into its own public bucket only', () => {
    expect(
      service.isOwnedUrl('https://img.motionhive.fit/motionhive/test/a.jpg'),
    ).toBe(true);
    expect(service.isOwnedUrl('https://img.motionhive.fit/other/a.jpg')).toBe(
      false,
    );
    expect(
      service.isOwnedUrl('http://img.motionhive.fit/motionhive/a.jpg'),
    ).toBe(false);
    expect(service.isOwnedUrl('https://evil.example/motionhive/a.jpg')).toBe(
      false,
    );
    expect(service.isOwnedUrl('not a url')).toBe(false);
  });

  it('still owns links into the old Cloudinary account until they are moved', () => {
    expect(
      service.isOwnedUrl(
        'https://res.cloudinary.com/oldcloud/image/upload/v1/motionhive/x.jpg',
      ),
    ).toBe(true);
    expect(
      service.isOwnedUrl(
        'https://res.cloudinary.com/someoneelse/image/upload/v1/x.jpg',
      ),
    ).toBe(false);
  });

  it('refuses a post that names a foreign image', () => {
    expect(() =>
      service.assertOwnedUrls([
        'https://img.motionhive.fit/motionhive/test/a.jpg',
        'https://tracker.example/pixel.gif',
      ]),
    ).toThrow(BadRequestException);
  });

  it('maps keys and links both ways', () => {
    const key = 'motionhive/test/avatars/u1/abc.jpg';
    const url = service.publicUrl(key);
    expect(url).toBe(
      'https://img.motionhive.fit/motionhive/test/avatars/u1/abc.jpg',
    );
    expect(service.keyFromUrl(url)).toBe(key);
    expect(
      service.keyFromUrl(
        'https://res.cloudinary.com/oldcloud/image/upload/v1/motionhive/x.jpg',
      ),
    ).toBeNull();
  });

  it('builds folders with the environment in the path', () => {
    expect(service.buildUserFolder('avatars', 'u1')).toBe(
      'motionhive/test/avatars/u1',
    );
    expect(service.buildPostFolder('u1', 'p1')).toBe(
      'motionhive/test/posts/u1/p1',
    );
    expect(service.buildPrivateFolder('workout-photos', 'u1')).toBe(
      'motionhive/test/workout-photos/u1',
    );
  });
});

describe('MediaStorageService public files', () => {
  it('stores a re-encoded picture under a new name in the person’s folder', async () => {
    const service = makeService();
    const jpeg = await sharp({
      create: { width: 10, height: 10, channels: 3, background: '#000' },
    })
      .jpeg()
      .toBuffer();

    const { url, publicId } = await service.uploadImage(file(jpeg), {
      resource: 'avatars',
      userId: 'u1',
    });

    expect(publicId).toMatch(/^motionhive\/test\/avatars\/u1\/[\w-]{16}\.jpg$/);
    expect(url).toBe(`https://img.motionhive.fit/${publicId}`);
    const put = sent[0] as PutObjectCommand;
    expect(put).toBeInstanceOf(PutObjectCommand);
    expect(put.input).toMatchObject({
      Bucket: 'pub',
      Key: publicId,
      ContentType: 'image/jpeg',
    });
  });

  it('answers a broken file with a 400, before anything is stored', async () => {
    const service = makeService();
    await expect(
      service.uploadImage(file(Buffer.from('broken')), { resource: 'posts' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(sent).toHaveLength(0);
  });

  it('answers with an error, not a crash, when storage is not set up', async () => {
    const service = makeService({ NODE_ENV: 'test' });
    await expect(
      service.uploadImage(file(Buffer.from('x')), { resource: 'posts' }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('copies one of our files server side for a post', async () => {
    const service = makeService();
    const { publicId } = await service.cloneByUrl(
      'https://img.motionhive.fit/motionhive/test/posts/u1/staged.png',
      { resource: 'posts', userId: 'u1', postId: 'p1' },
    );
    expect(publicId).toMatch(
      /^motionhive\/test\/posts\/u1\/p1\/[\w-]{16}\.png$/,
    );
    const copy = sent[0] as CopyObjectCommand;
    expect(copy).toBeInstanceOf(CopyObjectCommand);
    expect(copy.input.CopySource).toBe(
      'pub/motionhive/test/posts/u1/staged.png',
    );
  });

  it('refuses to copy a link that is not ours', async () => {
    const service = makeService();
    await expect(
      service.cloneByUrl('https://evil.example/a.png', { resource: 'posts' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('skips deleting an old Cloudinary link and never throws', async () => {
    const service = makeService();
    await service.deleteByUrl(
      'https://res.cloudinary.com/oldcloud/image/upload/v1/motionhive/x.jpg',
    );
    expect(sent).toHaveLength(0);

    send.mockRejectedValueOnce(new Error('down'));
    await expect(
      service.deleteByUrl('https://img.motionhive.fit/motionhive/test/a.jpg'),
    ).resolves.toBeUndefined();
  });

  it('deletes a folder page by page, matching the folder exactly', async () => {
    const service = makeService();
    send
      .mockImplementationOnce(
        answer({
          Contents: [{ Key: 'motionhive/test/posts/u1/p1/a.jpg' }],
          IsTruncated: true,
          NextContinuationToken: 't2',
        }),
      )
      .mockImplementationOnce(answer())
      .mockImplementationOnce(
        answer({
          Contents: [{ Key: 'motionhive/test/posts/u1/p1/b.jpg' }],
          IsTruncated: false,
        }),
      );

    await service.deleteFolder('motionhive/test/posts/u1/p1');

    const lists = sent.filter(
      (c): c is ListObjectsV2Command => c instanceof ListObjectsV2Command,
    );
    const deletes = sent.filter(
      (c): c is DeleteObjectsCommand => c instanceof DeleteObjectsCommand,
    );
    expect(lists.map((l) => l.input.Prefix)).toEqual([
      'motionhive/test/posts/u1/p1/',
      'motionhive/test/posts/u1/p1/',
    ]);
    expect(lists[1].input.ContinuationToken).toBe('t2');
    expect(deletes.flatMap((d) => d.input.Delete?.Objects)).toEqual([
      { Key: 'motionhive/test/posts/u1/p1/a.jpg' },
      { Key: 'motionhive/test/posts/u1/p1/b.jpg' },
    ]);
  });

  it('never deletes outside our key root', async () => {
    const service = makeService();
    await service.deleteFolder('');
    await service.deleteFolder('/');
    expect(sent).toHaveLength(0);
  });
});

describe('MediaStorageService private photos', () => {
  it('stores the photo and its thumbnail in the private bucket', async () => {
    const service = makeService();
    const jpeg = await sharp({
      create: { width: 900, height: 1200, channels: 3, background: '#123' },
    })
      .jpeg()
      .toBuffer();

    const { publicId, version } = await service.uploadPrivateImage(
      jpeg,
      'motionhive/test/workout-photos/u1',
      'wl-1',
    );

    expect(publicId).toBe('motionhive/test/workout-photos/u1/wl-1');
    expect(version).toBeGreaterThan(1_700_000_000);
    const puts = sent as PutObjectCommand[];
    expect(puts.map((p) => [p.input.Bucket, p.input.Key])).toEqual([
      ['priv', 'motionhive/test/workout-photos/u1/wl-1.jpg'],
      ['priv', 'motionhive/test/workout-photos/u1/wl-1_thumb.jpg'],
    ]);
  });

  it('reads the thumbnail, falling back to the whole photo when it is missing', async () => {
    const service = makeService();
    const id = 'motionhive/test/workout-photos/u1/wl-1';
    send.mockImplementation((c: unknown) =>
      (c as GetObjectCommand).input.Key === privateKey(id, 'thumb')
        ? missing()(c)
        : answer({
            Body: {
              transformToByteArray: () => Promise.resolve(Buffer.from('full')),
            },
          })(c),
    );

    const bytes = await service.fetchPrivateImage(id, { thumb: true });

    expect(bytes.toString()).toBe('full');
    expect(sent.map((c) => (c as GetObjectCommand).input.Key)).toEqual([
      `${id}_thumb.jpg`,
      `${id}.jpg`,
    ]);
  });

  it('answers 404 when the photo itself is gone', async () => {
    const service = makeService();
    send.mockImplementation(missing());
    await expect(service.fetchPrivateImage('a/b')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('deletes both files of a photo, best effort', async () => {
    const service = makeService();
    await service.deletePrivateImage('a/b');
    const del = sent[0] as DeleteObjectsCommand;
    expect(del.input.Bucket).toBe('priv');
    expect(del.input.Delete?.Objects).toEqual([
      { Key: 'a/b.jpg' },
      { Key: 'a/b_thumb.jpg' },
    ]);

    send.mockRejectedValueOnce(new Error('down'));
    await expect(service.deletePrivateImage('a/b')).resolves.toBeUndefined();
  });
});
