import { createHash } from 'crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { apiError } from '../../../common/i18n';
import { DevicePlatform, DeviceToken } from '../entities/device-token.entity';

/**
 * Web Push subscription shape — matches the browser's
 * PushSubscription serialized to JSON. We accept this shape
 * (not just a string) for the WEB platform so we can compute
 * `endpoint_hash` correctly without forcing the FE to do it.
 */
export interface WebPushSubscriptionPayload {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface RegisterDeviceParams {
  userId: string;
  platform: DevicePlatform;
  /**
   * For WEB: the JSON object with endpoint + keys.
   * For IOS / ANDROID: the FCM token string.
   */
  token: string | WebPushSubscriptionPayload;
  deviceLabel?: string;
}

/**
 * DeviceTokenService
 *
 * Per-device push registration. Storage is uniform across web &
 * mobile (one table) so the future push worker can fan out with a
 * single query and branch on `platform`.
 *
 * Re-registration is idempotent — same browser/device upserts on
 * (user_id, endpoint_hash) and bumps last_seen_at. Logout / revoke
 * sets `revoked_at` rather than hard-deleting; a future cleanup job
 * prunes rows where revoked_at is older than ~90 days.
 */
@Injectable()
export class DeviceTokenService {
  constructor(
    @InjectModel(DeviceToken)
    private readonly deviceModel: typeof DeviceToken,
  ) {}

  /**
   * Register or refresh a device. Returns the row that was written.
   * Safe to call on every login — same endpoint_hash → upsert.
   */
  async register(params: RegisterDeviceParams): Promise<DeviceToken> {
    const tokenString = this.serializeToken(params.token);
    const endpointHash = this.computeEndpointHash(
      params.platform,
      params.token,
    );

    // A device belongs to whoever is signed in on it now. The app's own
    // revoke on sign-out cannot be relied on (it runs after the session is
    // gone, so it fails with a 401), and without this the previous
    // account's alerts would keep reaching the next person's phone.
    await this.deviceModel.update(
      { revokedAt: new Date() },
      {
        where: {
          endpointHash,
          userId: { [Op.ne]: params.userId },
          revokedAt: { [Op.is]: null },
        },
      },
    );

    const existing = await this.deviceModel.findOne({
      where: { userId: params.userId, endpointHash },
    });

    if (existing) {
      existing.token = tokenString;
      existing.platform = params.platform;
      existing.deviceLabel = params.deviceLabel ?? existing.deviceLabel;
      existing.lastSeenAt = new Date();
      // Re-registration after a revoke un-revokes the device.
      existing.revokedAt = null;
      await existing.save();
      return existing;
    }

    return this.deviceModel.create({
      userId: params.userId,
      platform: params.platform,
      token: tokenString,
      endpointHash,
      deviceLabel: params.deviceLabel ?? null,
      lastSeenAt: new Date(),
    });
  }

  /**
   * List the user's active devices (for the "logged-in devices" UI
   * and for the future push worker).
   */
  async listActiveForUser(userId: string): Promise<DeviceToken[]> {
    return this.deviceModel.findAll({
      where: { userId, revokedAt: { [Op.is]: null } },
      order: [['lastSeenAt', 'DESC']],
    });
  }

  /**
   * Revoke a device (sets revoked_at). Used by:
   *   - the "remove device" UI action
   *   - logout (FE calls this)
   *   - the push worker on permanent failure (410 / NotRegistered)
   */
  async revoke(userId: string, deviceId: string): Promise<void> {
    const device = await this.deviceModel.findOne({
      where: { id: deviceId, userId },
    });
    if (!device) {
      // 404, not 403 — don't leak existence of other users' devices.
      throw new NotFoundException(apiError('notification.deviceNotFound'));
    }
    if (!device.revokedAt) {
      device.revokedAt = new Date();
      await device.save();
    }
  }

  /**
   * Internal helper for the future push worker. Marks a device as
   * stale when the push provider tells us the subscription/token is
   * permanently invalid (HTTP 410, FCM `NotRegistered`).
   */
  async markStale(deviceId: string): Promise<void> {
    await this.deviceModel.update(
      { revokedAt: new Date() },
      { where: { id: deviceId, revokedAt: { [Op.is]: null } } },
    );
  }

  /**
   * Heartbeat — bump last_seen_at. Cheap, no-op friendly.
   */
  async bumpLastSeen(userId: string, deviceId: string): Promise<void> {
    await this.deviceModel.update(
      { lastSeenAt: new Date() },
      { where: { id: deviceId, userId } },
    );
  }

  // ────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────

  private serializeToken(token: string | WebPushSubscriptionPayload): string {
    return typeof token === 'string' ? token : JSON.stringify(token);
  }

  /**
   * The dedup key per (user, device).
   *
   *   WEB:        sha256 of subscription.endpoint
   *   IOS/ANDROID: sha256 of the FCM token
   *
   * sha256 because endpoints can be very long (Web Push) and we need
   * a fixed-size column for the UNIQUE index.
   */
  private computeEndpointHash(
    platform: DevicePlatform,
    token: string | WebPushSubscriptionPayload,
  ): string {
    let unique: string;
    if (platform === DevicePlatform.WEB) {
      if (typeof token === 'string') {
        // Accept stringified subscription too — parse to get endpoint.
        try {
          const parsed = JSON.parse(token) as WebPushSubscriptionPayload;
          unique = parsed.endpoint;
        } catch {
          // Fall back to hashing the whole string (covers the case
          // where the FE pre-stringifies to a bare endpoint).
          unique = token;
        }
      } else {
        unique = token.endpoint;
      }
    } else {
      // FCM token IS the unique identifier.
      unique = typeof token === 'string' ? token : JSON.stringify(token);
    }
    return createHash('sha256').update(unique).digest('hex');
  }
}
