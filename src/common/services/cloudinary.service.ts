import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { v2 as cloudinary, UploadApiResponse } from 'cloudinary';
import { apiError } from '../i18n';

/**
 * Cloudinary upload context. The combination produces a path like
 *   motionhive/<env>/<resource>/<userId?>/<postId?>/<filename>
 * which keeps assets:
 *   - separated by environment (dev/staging/prod sharing one account),
 *   - grouped by feature (`posts`, `avatars`, `blog`),
 *   - partitioned per user when relevant — so GDPR erasure and per-user
 *     audits become a single `delete_resources_by_prefix` call,
 *   - partitioned per post when relevant — so `deletePost` can wipe a
 *     post's entire image set in one call.
 */
export interface UploadContext {
  /** Feature this asset belongs to (`posts`, `avatars`, `blog`, ...). */
  resource: string;
  /** Owning user id when the asset is user-scoped. */
  userId?: string;
  /** Owning post id (post images only). */
  postId?: string;
}

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);
  private configured = false;
  private readonly cloudName: string | undefined;
  private readonly envPrefix: string;

  constructor(private configService: ConfigService) {
    const cloudName = this.configService.get<string>('CLOUDINARY_CLOUD_NAME');
    const apiKey = this.configService.get<string>('CLOUDINARY_API_KEY');
    const apiSecret = this.configService.get<string>('CLOUDINARY_API_SECRET');

    this.cloudName = cloudName;
    // Asset path is namespaced by NODE_ENV so dev uploads can't collide
    // with production assets when both share a single Cloudinary account.
    const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development';
    this.envPrefix = nodeEnv;

    if (cloudName && apiKey && apiSecret) {
      cloudinary.config({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
      });
      this.configured = true;
    }
  }

  /**
   * Returns true if the URL points at our Cloudinary account, false otherwise.
   *
   * Why: post/blog clients can pass any URL into `mediaUrls`. Without this
   * check, the FE renders `<img src="…">` against arbitrary external hosts —
   * phishing CDNs, IP-leak via referer, etc. We only allow URLs we ourselves
   * uploaded. Falls back to host-only check when CLOUDINARY_CLOUD_NAME isn't
   * configured (dev environments).
   */
  isOwnedUrl(rawUrl: string): boolean {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return false;
    }
    if (url.protocol !== 'https:') return false;
    if (url.hostname !== 'res.cloudinary.com') return false;
    if (this.cloudName) {
      // path is /<cloud_name>/image/upload/...
      return url.pathname.startsWith(`/${this.cloudName}/`);
    }
    return true;
  }

  assertOwnedUrls(urls: string[]): void {
    for (const url of urls) {
      if (!this.isOwnedUrl(url)) {
        throw new BadRequestException(apiError('common.imageNotUploaded'));
      }
    }
  }

  /** Build the Cloudinary `folder:` for an upload from the context. */
  private buildFolder(ctx: UploadContext): string {
    const parts = ['motionhive', this.envPrefix, ctx.resource];
    if (ctx.userId) parts.push(ctx.userId);
    if (ctx.postId) parts.push(ctx.postId);
    return parts.join('/');
  }

  async uploadImage(
    file: Express.Multer.File,
    ctx: UploadContext,
  ): Promise<{ url: string; publicId: string }> {
    if (!file) {
      throw new BadRequestException(apiError('common.noFile'));
    }

    if (!this.configured) {
      throw new InternalServerErrorException(
        'Cloudinary is not configured. Check CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
      );
    }

    let result: UploadApiResponse;
    try {
      result = await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream(
            {
              folder: this.buildFolder(ctx),
              resource_type: 'image',
              transformation: [{ quality: 'auto', fetch_format: 'auto' }],
            },
            (error, uploadResult) => {
              if (error) return reject(error);
              resolve(uploadResult!);
            },
          )
          .end(file.buffer);
      });
    } catch (error: unknown) {
      // Cloudinary SDK rejects with a plain object (`{ message, http_code,
      // name }`) rather than an Error instance, so `instanceof Error`
      // alone drops the real message on the floor. Narrow via a type
      // guard on the `message` property so we surface whatever the SDK
      // actually said (e.g. "Invalid image file", "cloud_name required",
      // "api_key mismatch", ...).
      let message = 'Unknown Cloudinary error';
      if (error instanceof Error) {
        message = error.message;
      } else if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof error.message === 'string'
      ) {
        message = (error as { message: string }).message;
      }
      // Log the full error object (not PII) so we can see http_code,
      // name, etc. in Railway logs when "message" alone isn't enough.
      this.logger.error(
        `Cloudinary upload failed: ${message}`,
        JSON.stringify(error, Object.getOwnPropertyNames(error ?? {})),
      );
      throw new InternalServerErrorException(
        apiError('common.imageUploadFailed'),
      );
    }

    return {
      url: result.secure_url,
      publicId: result.public_id,
    };
  }

  async deleteImage(publicId: string): Promise<void> {
    const result = (await cloudinary.uploader.destroy(publicId)) as {
      result?: string;
    };
    // Cloudinary returns { result: 'ok' } on success, { result: 'not found' }
    // when the publicId doesn't exist. We log the latter because it usually
    // means our extractPublicId parsing is off for that URL shape.
    if (result?.result && result.result !== 'ok') {
      this.logger.warn(
        `Cloudinary destroy for ${publicId} returned: ${result.result}`,
      );
    }
  }

  /**
   * Parse the Cloudinary publicId out of a secure_url.
   *
   * Cloudinary URLs we generate have the shape:
   *   https://res.cloudinary.com/<cloud>/image/upload/[transformations/]v<version>/<folder>/<name>.<ext>
   *
   * publicId is `<folder>/<name>` (no extension, no version, no transformations).
   * Returns null when the URL doesn't match — callers should treat that as
   * "nothing to clean up" rather than an error.
   */
  extractPublicId(rawUrl: string): string | null {
    if (!this.isOwnedUrl(rawUrl)) return null;
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return null;
    }
    // pathname: /<cloud>/image/upload/[transformations/]v<version>/<publicIdWithExt>
    const segments = url.pathname.split('/').filter(Boolean);
    const uploadIdx = segments.indexOf('upload');
    if (uploadIdx === -1 || uploadIdx === segments.length - 1) return null;

    // Skip any transformation segments + the version segment (`v<digits>`).
    let cursor = uploadIdx + 1;
    while (cursor < segments.length && !/^v\d+$/.test(segments[cursor])) {
      cursor++;
    }
    if (cursor >= segments.length) {
      // No version segment found — treat the whole tail after `upload` as
      // the publicId (some legacy URLs lack `v<version>`).
      cursor = uploadIdx;
    }
    const tail = segments.slice(cursor + 1);
    if (tail.length === 0) return null;
    const last = tail[tail.length - 1];
    const dot = last.lastIndexOf('.');
    tail[tail.length - 1] = dot > 0 ? last.slice(0, dot) : last;
    return tail.join('/');
  }

  /**
   * Clone a Cloudinary asset into a new folder by re-uploading it from
   * its public URL. Used by the post fan-out flow: the FE uploads images
   * once via /posts/upload-image (staging folder), then the BE clones
   * them per post so each post owns its own assets cleanly. Returns the
   * new secure_url + publicId.
   */
  async cloneByUrl(
    srcUrl: string,
    ctx: UploadContext,
  ): Promise<{ url: string; publicId: string }> {
    if (!this.configured) {
      throw new InternalServerErrorException(
        'Cloudinary is not configured. Check CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET.',
      );
    }
    const result = await cloudinary.uploader.upload(srcUrl, {
      folder: this.buildFolder(ctx),
      resource_type: 'image',
    });
    return { url: result.secure_url, publicId: result.public_id };
  }

  /**
   * Best-effort prefix delete: removes every asset whose publicId starts
   * with the given folder path. Used when a post is destroyed — we
   * delete the whole `motionhive/<env>/posts/<userId>/<postId>/` folder
   * in one Cloudinary call rather than walking each mediaUrl.
   */
  async deleteFolder(folderPath: string): Promise<void> {
    if (!this.configured) return;
    try {
      await cloudinary.api.delete_resources_by_prefix(folderPath);
      // Best-effort: cleans up the now-empty folder node from the UI tree.
      // Cloudinary returns an error if the folder isn't empty or doesn't
      // exist; we swallow both.
      try {
        await cloudinary.api.delete_folder(folderPath);
      } catch {
        /* folder already gone or had nested non-empty subfolders */
      }
    } catch (err) {
      this.logger.warn(
        `Cloudinary delete_resources_by_prefix(${folderPath}) failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  /**
   * A person's own folder for one resource (their avatars, say). Account
   * erasure deletes it in one prefix call; see `deleteFolder`.
   */
  buildUserFolder(resource: UploadContext['resource'], userId: string): string {
    return this.buildFolder({ resource, userId });
  }

  /** Path used by the per-post folder. Exposed so callers can build it
   *  without depending on the env-prefix internals. */
  buildPostFolder(userId: string, postId: string): string {
    return this.buildFolder({ resource: 'posts', userId, postId });
  }

  /**
   * Best-effort delete of a single Cloudinary asset given its URL. Errors
   * are swallowed and logged — the caller has already committed the
   * user-visible state change (post deleted, cover replaced, etc.) and
   * we don't want a Cloudinary outage to roll that back. Orphans can be
   * swept later.
   */
  async deleteByUrl(rawUrl: string | null | undefined): Promise<void> {
    if (!rawUrl) {
      this.logger.debug(`deleteByUrl: skipping empty url`);
      return;
    }
    const publicId = this.extractPublicId(rawUrl);
    if (!publicId) {
      this.logger.warn(
        `deleteByUrl: could not extract publicId from "${rawUrl}" (cloudName=${this.cloudName ?? 'unset'}) — skipping`,
      );
      return;
    }
    this.logger.log(
      `deleteByUrl: destroying publicId="${publicId}" (from "${rawUrl}")`,
    );
    try {
      await this.deleteImage(publicId);
    } catch (err) {
      this.logger.warn(
        `Cloudinary delete failed for ${publicId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
