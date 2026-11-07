import { randomBytes } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

import { apiError } from '../i18n';
import {
  normaliseImage,
  privateKey,
  privatePhotoVariants,
} from '../utils/image-processing';

/**
 * Where an upload goes. Keys look like
 *   motionhive/<env>/<resource>/<userId?>/<postId?>/<file>
 * which keeps files:
 *   - grouped by feature (`posts`, `avatars`, `blog`, `exercises`, ...),
 *   - partitioned per person, so account erasure is one prefix delete,
 *   - partitioned per post, so deleting a post is one prefix delete.
 *
 * The layout is the one the Cloudinary public ids had, so a moved file
 * keeps its path and a stored private photo id still names its file.
 */
export interface UploadContext {
  /** Feature this file belongs to (`posts`, `avatars`, `blog`, ...). */
  resource: string;
  /** Owning user id when the file is user-scoped. */
  userId?: string;
  /** Owning post id (post images only). */
  postId?: string;
}

/**
 * `public`: served at `MEDIA_PUBLIC_URL`, resized on the way out by
 * Cloudflare. `private`: no address at all; the API reads it for a
 * reader it has checked and streams the bytes.
 */
export type MediaBucket = 'public' | 'private';

const KEY_ROOT = 'motionhive';

/** Public keys are never reused (each upload gets a new name). */
const PUBLIC_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** A file from the old host is fetched once, when a post copies it. */
const LEGACY_FETCH_TIMEOUT_MS = 10_000;

/** The host of the old provider, whose links the move script rewrites. */
const LEGACY_HOST = 'res.cloudinary.com';

/** S3 lets one DeleteObjects call name at most 1000 keys. */
const DELETE_BATCH = 1000;

/**
 * Pictures in Cloudflare R2 (S3 API). Two buckets per environment: a
 * public one behind `img.motionhive.fit` (avatars, posts, blog covers,
 * exercise pictures) and a private one for workout photos.
 *
 * Every public upload is re-encoded first (`normaliseImage`), which is
 * what keeps location data out of a public file. Old Cloudinary links of
 * our own account are still accepted as ours until the move script has
 * rewritten them; nothing new is written there.
 */
@Injectable()
export class MediaStorageService {
  private readonly logger = new Logger(MediaStorageService.name);
  private readonly client: S3Client | null;
  private readonly publicBucket: string;
  private readonly privateBucket: string;
  private readonly publicBaseUrl: URL | null;
  private readonly envPrefix: string;
  private readonly legacyCloudName: string | undefined;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('R2_ENDPOINT');
    const accessKeyId = this.configService.get<string>('R2_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>(
      'R2_SECRET_ACCESS_KEY',
    );
    const publicUrl = this.configService.get<string>('MEDIA_PUBLIC_URL');
    this.publicBucket =
      this.configService.get<string>('R2_PUBLIC_BUCKET') ?? '';
    this.privateBucket =
      this.configService.get<string>('R2_PRIVATE_BUCKET') ?? '';
    this.publicBaseUrl = null;
    if (publicUrl) {
      this.publicBaseUrl = new URL(publicUrl);
    }
    // Keys keep the environment in their path, as the old ids did, so a
    // dev file can never be mistaken for a production one.
    this.envPrefix =
      this.configService.get<string>('NODE_ENV') ?? 'development';
    this.legacyCloudName = this.configService.get<string>(
      'CLOUDINARY_CLOUD_NAME',
    );

    const configured =
      !!endpoint &&
      !!accessKeyId &&
      !!secretAccessKey &&
      !!this.publicBucket &&
      !!this.privateBucket &&
      !!this.publicBaseUrl;
    this.client = null;
    if (configured) {
      this.client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
        // R2 does not take the checksum headers newer SDKs add to every
        // request by default; only send them where S3 needs one.
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
        requestHandler: { connectionTimeout: 5_000, requestTimeout: 20_000 },
      });
    }
  }

  // ─── Links ─────────────────────────────────────────────────────────

  /**
   * True when the link points at a file we stored. Post and blog clients
   * send links back; without this check the apps would render
   * `<img src>` from any host (tracking pixels, phishing CDNs).
   */
  isOwnedUrl(rawUrl: string): boolean {
    const url = parseHttps(rawUrl);
    if (!url) {
      return false;
    }
    if (this.publicBaseUrl && url.host === this.publicBaseUrl.host) {
      return url.pathname.startsWith(`/${KEY_ROOT}/`);
    }
    return this.isLegacyUrl(url);
  }

  assertOwnedUrls(urls: string[]): void {
    for (const url of urls) {
      if (!this.isOwnedUrl(url)) {
        throw new BadRequestException(apiError('common.imageNotUploaded'));
      }
    }
  }

  /** The public link of a key in the public bucket. */
  publicUrl(key: string): string {
    if (!this.publicBaseUrl) {
      throw this.notConfigured();
    }
    return new URL(key, ensureTrailingSlash(this.publicBaseUrl)).toString();
  }

  /** The key behind one of our public links, or null for any other link. */
  keyFromUrl(rawUrl: string): string | null {
    const url = parseHttps(rawUrl);
    if (!url || !this.publicBaseUrl || url.host !== this.publicBaseUrl.host) {
      return null;
    }
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!key.startsWith(`${KEY_ROOT}/`)) {
      return null;
    }
    return key;
  }

  buildUserFolder(resource: UploadContext['resource'], userId: string): string {
    return this.buildFolder({ resource, userId });
  }

  buildPostFolder(userId: string, postId: string): string {
    return this.buildFolder({ resource: 'posts', userId, postId });
  }

  /** Where a person's private photos of one kind live; erasure deletes it. */
  buildPrivateFolder(resource: string, userId: string): string {
    return this.buildFolder({ resource, userId });
  }

  // ─── Public files ──────────────────────────────────────────────────

  /**
   * Stores a public picture under a new name. `publicId` is the storage
   * key; the name is kept because the upload routes already return it.
   */
  async uploadImage(
    file: Express.Multer.File,
    ctx: UploadContext,
  ): Promise<{ url: string; publicId: string }> {
    if (!file) {
      throw new BadRequestException(apiError('common.noFile'));
    }
    const client = this.requireClient();

    let processed: Awaited<ReturnType<typeof normaliseImage>>;
    try {
      processed = await normaliseImage(file.buffer);
    } catch (err) {
      this.logger.warn(`Image did not decode: ${errorMessage(err)}`);
      throw new BadRequestException(apiError('common.imageOnly'));
    }

    const key = `${this.buildFolder(ctx)}/${newName()}.${processed.extension}`;
    try {
      await client.send(
        new PutObjectCommand({
          Bucket: this.publicBucket,
          Key: key,
          Body: processed.buffer,
          ContentType: processed.contentType,
          CacheControl: PUBLIC_CACHE_CONTROL,
        }),
      );
    } catch (err) {
      this.logger.error(`Upload of ${key} failed: ${errorMessage(err)}`);
      throw new InternalServerErrorException(
        apiError('common.imageUploadFailed'),
      );
    }
    return { url: this.publicUrl(key), publicId: key };
  }

  /** Deletes one public file by key. Throws, so the caller decides. */
  async deleteImage(key: string): Promise<void> {
    const client = this.client;
    if (!client || !key.startsWith(`${KEY_ROOT}/`)) {
      return;
    }
    await client.send(
      new DeleteObjectCommand({ Bucket: this.publicBucket, Key: key }),
    );
  }

  /**
   * Best effort: the caller has already committed what the person sees
   * (post deleted, cover replaced), and a storage hiccup must not undo
   * it. An old Cloudinary link is skipped; that account goes as a whole.
   */
  async deleteByUrl(rawUrl: string | null | undefined): Promise<void> {
    if (!rawUrl) {
      return;
    }
    const key = this.keyFromUrl(rawUrl);
    if (!key) {
      this.logger.debug(`deleteByUrl: not one of our files, skipping`);
      return;
    }
    try {
      await this.deleteImage(key);
    } catch (err) {
      this.logger.warn(`Delete of ${key} failed: ${errorMessage(err)}`);
    }
  }

  /**
   * A copy of one of our public files under a new folder. Posts use it:
   * the composer uploads once, and each post gets its own copy, so
   * deleting a post can clear its folder without touching another post.
   */
  async cloneByUrl(
    srcUrl: string,
    ctx: UploadContext,
  ): Promise<{ url: string; publicId: string }> {
    const client = this.requireClient();
    const folder = this.buildFolder(ctx);
    const srcKey = this.keyFromUrl(srcUrl);

    if (srcKey) {
      const key = `${folder}/${newName()}${extensionOf(srcKey)}`;
      await client.send(
        new CopyObjectCommand({
          Bucket: this.publicBucket,
          Key: key,
          CopySource: `${this.publicBucket}/${encodeKey(srcKey)}`,
        }),
      );
      return { url: this.publicUrl(key), publicId: key };
    }

    // A link from before the move: fetch it once and store it here.
    const legacy = parseHttps(srcUrl);
    if (!legacy || !this.isLegacyUrl(legacy)) {
      throw new BadRequestException(apiError('common.imageNotUploaded'));
    }
    const res = await fetch(legacy, {
      signal: AbortSignal.timeout(LEGACY_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new InternalServerErrorException(
        apiError('common.imageUploadFailed'),
      );
    }
    const key = `${folder}/${newName()}${extensionOf(legacy.pathname)}`;
    let contentType = res.headers.get('content-type');
    if (!contentType) {
      contentType = 'image/jpeg';
    }
    await client.send(
      new PutObjectCommand({
        Bucket: this.publicBucket,
        Key: key,
        Body: Buffer.from(await res.arrayBuffer()),
        ContentType: contentType,
        CacheControl: PUBLIC_CACHE_CONTROL,
      }),
    );
    return { url: this.publicUrl(key), publicId: key };
  }

  /**
   * Best effort: deletes every file under a folder (a post, or one
   * person's avatars). The folder is matched with its trailing slash, so
   * `…/posts/<user>/<post>` never reaches a sibling that shares a prefix.
   */
  async deleteFolder(
    folderPath: string,
    bucket: MediaBucket = 'public',
  ): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    let prefix = folderPath;
    if (!prefix.endsWith('/')) {
      prefix = `${prefix}/`;
    }
    if (!prefix.startsWith(`${KEY_ROOT}/`)) {
      return;
    }
    const Bucket = this.bucketName(bucket);
    try {
      let token: string | undefined;
      do {
        const page = await client.send(
          new ListObjectsV2Command({
            Bucket,
            Prefix: prefix,
            ContinuationToken: token,
            MaxKeys: DELETE_BATCH,
          }),
        );
        const keys: string[] = [];
        for (const object of page.Contents ?? []) {
          if (object.Key) {
            keys.push(object.Key);
          }
        }
        if (keys.length > 0) {
          await client.send(
            new DeleteObjectsCommand({
              Bucket,
              Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
            }),
          );
        }
        token = undefined;
        if (page.IsTruncated) {
          token = page.NextContinuationToken;
        }
      } while (token);
    } catch (err) {
      this.logger.warn(
        `Folder delete of ${prefix} (${bucket}) failed: ${errorMessage(err)}`,
      );
    }
  }

  // ─── Private photos ────────────────────────────────────────────────
  //
  // Workout photos have no address anyone could share. The API checks
  // who is asking and streams the bytes (`fetchPrivateImage`).

  /**
   * Stores the photo (already stripped of metadata by the caller) and
   * its thumbnail at a fixed id, overwriting what was there: one photo
   * per thing, nothing orphaned on a replace. `version` changes on every
   * write, so the apps can tell a replaced photo from a cached one.
   */
  async uploadPrivateImage(
    jpeg: Buffer,
    folder: string,
    name: string,
  ): Promise<{ publicId: string; version: number }> {
    const client = this.requireClient();
    let variants: { full: Buffer; thumb: Buffer };
    try {
      variants = await privatePhotoVariants(jpeg);
    } catch (err) {
      this.logger.warn(`Private photo did not decode: ${errorMessage(err)}`);
      throw new BadRequestException(apiError('common.imageOnly'));
    }
    const id = `${folder}/${name}`;
    try {
      await Promise.all([
        this.putPrivate(client, privateKey(id, 'full'), variants.full),
        this.putPrivate(client, privateKey(id, 'thumb'), variants.thumb),
      ]);
    } catch (err) {
      this.logger.error(`Private upload of ${id} failed: ${errorMessage(err)}`);
      throw new InternalServerErrorException(
        apiError('common.imageUploadFailed'),
      );
    }
    return { publicId: id, version: Math.floor(Date.now() / 1000) };
  }

  /**
   * The bytes of a private photo, for a reader the caller has checked.
   * A missing thumbnail falls back to the whole photo.
   */
  async fetchPrivateImage(
    id: string,
    options: { thumb?: boolean } = {},
  ): Promise<Buffer> {
    const client = this.requireClient();
    if (options.thumb) {
      const thumb = await this.getPrivate(client, privateKey(id, 'thumb'));
      if (thumb) {
        return thumb;
      }
    }
    const full = await this.getPrivate(client, privateKey(id, 'full'));
    if (!full) {
      throw new NotFoundException(apiError('common.notFound'));
    }
    return full;
  }

  /** Best effort: the row no longer points at it either way. */
  async deletePrivateImage(id: string): Promise<void> {
    const client = this.client;
    if (!client) {
      return;
    }
    try {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: this.privateBucket,
          Delete: {
            Objects: [
              { Key: privateKey(id, 'full') },
              { Key: privateKey(id, 'thumb') },
            ],
            Quiet: true,
          },
        }),
      );
    } catch (err) {
      this.logger.warn(`Private delete of ${id} failed: ${errorMessage(err)}`);
    }
  }

  // ─── Internals ─────────────────────────────────────────────────────

  private buildFolder(ctx: UploadContext): string {
    const parts = [KEY_ROOT, this.envPrefix, ctx.resource];
    if (ctx.userId) {
      parts.push(ctx.userId);
    }
    if (ctx.postId) {
      parts.push(ctx.postId);
    }
    return parts.join('/');
  }

  private isLegacyUrl(url: URL): boolean {
    return (
      !!this.legacyCloudName &&
      url.hostname === LEGACY_HOST &&
      url.pathname.startsWith(`/${this.legacyCloudName}/`)
    );
  }

  private bucketName(bucket: MediaBucket): string {
    if (bucket === 'private') {
      return this.privateBucket;
    }
    return this.publicBucket;
  }

  private async putPrivate(
    client: S3Client,
    key: string,
    body: Buffer,
  ): Promise<void> {
    await client.send(
      new PutObjectCommand({
        Bucket: this.privateBucket,
        Key: key,
        Body: body,
        ContentType: 'image/jpeg',
      }),
    );
  }

  /** The bytes, or null when the key does not exist. */
  private async getPrivate(
    client: S3Client,
    key: string,
  ): Promise<Buffer | null> {
    try {
      const res = await client.send(
        new GetObjectCommand({ Bucket: this.privateBucket, Key: key }),
      );
      if (!res.Body) {
        return null;
      }
      return Buffer.from(await res.Body.transformToByteArray());
    } catch (err) {
      if (err instanceof NoSuchKey) {
        return null;
      }
      this.logger.error(`Private read of ${key} failed: ${errorMessage(err)}`);
      throw new InternalServerErrorException();
    }
  }

  private requireClient(): S3Client {
    if (!this.client) {
      throw this.notConfigured();
    }
    return this.client;
  }

  private notConfigured(): InternalServerErrorException {
    this.logger.error(
      'Media storage is not configured. Set R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_PUBLIC_BUCKET, R2_PRIVATE_BUCKET and MEDIA_PUBLIC_URL.',
    );
    return new InternalServerErrorException(
      apiError('common.imageUploadFailed'),
    );
  }
}

function newName(): string {
  return randomBytes(12).toString('base64url');
}

/** `.jpg` from `a/b/c.jpg`; empty when the last segment has no dot. */
function extensionOf(path: string): string {
  const last = path.slice(path.lastIndexOf('/') + 1);
  const dot = last.lastIndexOf('.');
  if (dot <= 0) {
    return '';
  }
  return last.slice(dot).toLowerCase();
}

/** CopySource is a URL path: each segment encoded, the slashes kept. */
function encodeKey(key: string): string {
  return key.split('/').map(encodeURIComponent).join('/');
}

function parseHttps(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

function ensureTrailingSlash(url: URL): URL {
  if (url.pathname.endsWith('/')) {
    return url;
  }
  return new URL(`${url.toString()}/`);
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
