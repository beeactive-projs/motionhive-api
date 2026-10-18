import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  Notification,
  NotificationAudienceType,
  NotificationData,
  NotificationSeverity,
} from './entities/notification.entity';
import {
  DeliveredChannels,
  DeliveredChannelStatus,
  NotificationReceipt,
} from './entities/notification-receipt.entity';
import {
  ChannelPreferences,
  NotificationPreference,
} from './entities/notification-preference.entity';
import { resolveChannels } from './notification-defaults';
import { NotificationType } from './notification-types';
import {
  NotificationMessage,
  renderNotificationMessage,
  renderStoredNotification,
} from './notification-message';
import { DEFAULT_LOCALE, Locale, toLocale, translate } from '../../common/i18n';
import { User } from '../user/entities/user.entity';
import { EmailService } from '../../common/services/email.service';
import { JobsService } from '../jobs/jobs.service';

// Re-export so existing call sites that import NotificationType from
// notification.service keep working without churn.
export { NotificationType } from './notification-types';

/**
 * What the notification says. One of two shapes:
 *
 * - `message`: a catalog key plus raw params. The text is rendered per
 *   recipient, in their language. This is the shape to use.
 * - `title` + `body`: finished text, shown to everyone as is, whatever
 *   their language. For text that has no catalog entry by nature: the
 *   debug endpoint, which sends whatever an operator types. Product
 *   notifications never use it.
 */
type NotifyContent =
  | { message: NotificationMessage; title?: never; body?: never }
  | { title: string; body: string; message?: never };

interface NotifyOptions {
  type: NotificationType;
  data?: NotificationData;
  severity?: NotificationSeverity;
  /** sha256 dedup key — if a notification with this fingerprint already
   *  exists, the call is a no-op (returns the existing notification). */
  fingerprint?: string;
  /**
   * Email button label for `title` + `body` producers. A `message`
   * defines its own in the catalog (`cta`).
   */
  ctaLabel?: string;
  /**
   * Per-call channel override applied AFTER the user's resolved
   * preferences. Use this to suppress a single channel for a specific
   * delivery — e.g. messaging suppresses email after the first message
   * in a conversation per hour ("Slack-style" throttle), while keeping
   * the in-app notification on every message.
   *
   * Partial: only the channels you set are overridden. `{ email: false }`
   * leaves in-app / push / sms alone.
   */
  channelOverride?: Partial<ChannelPreferences>;
}

/** A notification for many users: everything except the recipient. */
export type NotifyManyParams = NotifyOptions & NotifyContent;

export type NotifyParams = NotifyManyParams & { userId: string };

export interface NotifyResult {
  notificationId: string;
  receiptId: string;
  /** True when an existing fingerprint was found and we returned that
   *  instead of creating a new row. */
  deduped: boolean;
  delivered: DeliveredChannels;
}

/**
 * Persists a notification, writes per-recipient receipts, and triggers
 * in-app + email delivery. Push and SMS channels are stubbed (set to
 * `'skipped:not_implemented'`) until those workers land.
 */
@Injectable()
export class NotificationService {
  constructor(
    @InjectModel(Notification)
    private readonly notificationModel: typeof Notification,
    @InjectModel(NotificationReceipt)
    private readonly receiptModel: typeof NotificationReceipt,
    @InjectModel(NotificationPreference)
    private readonly preferenceModel: typeof NotificationPreference,
    @InjectModel(User)
    private readonly userModel: typeof User,
    private readonly sequelize: Sequelize,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly jobs: JobsService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Send a notification to a single user.
   *
   * Persists the alert + receipt in a single transaction, then
   * synchronously fires per-channel delivery. Delivery failures do
   * not roll back the in-app row — the receipt records the failure
   * in `delivered_channels` so it can be retried out-of-band later.
   */
  async notify(params: NotifyParams): Promise<NotifyResult> {
    const { userId, ...rest } = params;
    const result = await this.notifyMany([userId], rest);
    return result.results[0];
  }

  /**
   * Send the same notification to many users (e.g. all session
   * participants). Creates ONE notification row + N receipts, then
   * fans out per-channel delivery in parallel.
   */
  async notifyMany(
    userIds: string[],
    params: NotifyManyParams,
  ): Promise<{
    notificationId: string;
    deduped: boolean;
    results: NotifyResult[];
  }> {
    if (userIds.length === 0) {
      throw new Error('notifyMany called with empty userIds');
    }

    // Dedup the userIds list — a participant array could contain a
    // user twice, and we want at most one receipt per user.
    const uniqueUserIds = Array.from(new Set(userIds));

    const { notification, deduped } = await this.sequelize.transaction(
      async (tx) => {
        const existing = params.fingerprint
          ? await this.notificationModel.findOne({
              where: { fingerprint: params.fingerprint },
              transaction: tx,
            })
          : null;

        if (existing) {
          return { notification: existing, deduped: true };
        }

        // Only USER audience today; GROUP/PLATFORM are reserved.
        const audienceType = NotificationAudienceType.USER;
        const audienceId = uniqueUserIds.length === 1 ? uniqueUserIds[0] : null;

        // The row always carries English text. For a catalog message it
        // is the fallback rendering; readers get their own language from
        // messageKey + messageParams.
        const text = params.message
          ? renderNotificationMessage(params.message, DEFAULT_LOCALE)
          : { title: params.title, body: params.body };

        const created = await this.notificationModel.create(
          {
            type: params.type,
            title: text.title,
            body: text.body,
            messageKey: params.message?.key ?? null,
            messageParams: params.message?.params ?? null,
            data: params.data ?? null,
            severity: params.severity ?? NotificationSeverity.INFO,
            audienceType,
            audienceId,
            fingerprint: params.fingerprint ?? null,
          },
          { transaction: tx },
        );

        return { notification: created, deduped: false };
      },
    );

    // Pre-load preferences for everyone in one query.
    const prefRows = await this.preferenceModel.findAll({
      where: {
        userId: { [Op.in]: uniqueUserIds },
        type: params.type,
      },
    });
    const prefByUser = new Map<string, ChannelPreferences>(
      prefRows.map((p) => [p.userId, p.channels]),
    );

    // Pre-load user emails + languages (single query).
    const users = await this.userModel.findAll({
      where: { id: { [Op.in]: uniqueUserIds } },
      attributes: ['id', 'email', 'firstName', 'language', 'isActive'],
    });
    const userById = new Map(users.map((u) => [u.id, u]));

    const results: NotifyResult[] = [];
    for (const userId of uniqueUserIds) {
      const resolved = resolveChannels(
        params.type,
        prefByUser.get(userId) ?? null,
      );
      // Per-call override applies AFTER user preferences. Used by
      // messaging to throttle email while keeping in-app on every send.
      const channels: Required<ChannelPreferences> = params.channelOverride
        ? { ...resolved, ...params.channelOverride }
        : resolved;
      const user = userById.get(userId);
      // A deactivated account (closing, or switched off by support) gets
      // nothing: no inbox row, no email, no push. Otherwise someone deleting
      // their account would be emailed about everything it winds down, and
      // reminders would keep reaching an account that is gone.
      if (user?.isActive === false) continue;

      const { receipt, delivered } = await this.deliverToUser({
        notification,
        userId,
        userEmail: user?.email ?? null,
        locale: toLocale(user?.language),
        channels,
        ctaLabel: params.ctaLabel,
      });

      results.push({
        notificationId: notification.id,
        receiptId: receipt.id,
        deduped,
        delivered,
      });
    }

    this.logger.log(
      `[NOTIFICATION] ${params.type} → ${uniqueUserIds.length} users (notification=${notification.id})`,
      'NotificationService',
    );

    return { notificationId: notification.id, deduped, results };
  }

  /**
   * Deliver a single notification to a single user across all
   * enabled channels. Receipt is upserted via findOrCreate so a
   * re-run with the same fingerprint just finds the existing receipt.
   */
  private async deliverToUser(input: {
    notification: Notification;
    userId: string;
    userEmail: string | null;
    locale: Locale;
    channels: Required<ChannelPreferences>;
    ctaLabel?: string;
  }): Promise<{ receipt: NotificationReceipt; delivered: DeliveredChannels }> {
    const { notification, userId, userEmail, channels } = input;

    // This recipient's wording. Rendered from the row (not the notify
    // params) so a fingerprint-deduped call delivers what was stored.
    const text = renderStoredNotification(notification, input.locale);
    const ctaLabel =
      text.cta ??
      input.ctaLabel ??
      translate(text.locale, 'email.layout.openApp');

    const [receipt] = await this.receiptModel.findOrCreate({
      where: { notificationId: notification.id, userId },
      defaults: {
        notificationId: notification.id,
        userId,
        deliveredAt: new Date(),
        deliveredChannels: {},
      },
    });

    const delivered: DeliveredChannels = { ...receipt.deliveredChannels };

    // ── in-app ──────────────────────────────────────────────
    // The receipt row IS the in-app delivery. Mark it sent unless
    // the user has explicitly disabled the channel (rare).
    delivered.in_app = channels.in_app ? 'sent' : 'skipped:preference_off';

    // ── email ──
    // Enqueued as a BullMQ job; the worker writes the final
    // 'sent'/'failed:...' status to delivered_channels. jobId =
    // receipt.id so retry-enqueue is deduped at the queue level.
    if (!channels.email) {
      delivered.email = 'skipped:preference_off';
    } else if (!userEmail) {
      delivered.email = 'skipped:no_email';
    } else {
      const ctaUrl = this.buildCtaUrl(notification.data);
      const enqueued = await this.jobs.enqueue(
        'notifications.email_send',
        {
          receiptId: receipt.id,
          to: userEmail,
          title: text.title,
          body: text.body,
          locale: text.locale,
          ctaUrl,
          ctaLabel: ctaUrl ? ctaLabel : undefined,
        },
        { jobId: `email_send.${receipt.id}` },
      );
      // `enqueued === null` means Redis isn't configured (dev mode
      // without REDIS_HOST). Fall back to a synchronous send so
      // emails still go out — this is the dev-friendly degradation
      // path documented on JobsService.
      if (enqueued === null) {
        const status = await this.emailService.sendNotificationEmail({
          to: userEmail,
          title: text.title,
          body: text.body,
          locale: text.locale,
          ctaUrl,
          ctaLabel: ctaUrl ? ctaLabel : undefined,
        });
        delivered.email = status.ok
          ? 'sent'
          : `failed:${status.reason.slice(0, 200)}`;
      } else {
        delivered.email = 'queued';
      }
    }

    // ── push ──
    // Enqueued like email. The worker reads the user's live device
    // list rather than taking it from the payload, because a token can
    // be revoked between here and delivery.
    if (!channels.push) {
      delivered.push = 'skipped:preference_off';
    } else {
      const enqueued = await this.jobs.enqueue(
        'notifications.push_send',
        {
          receiptId: receipt.id,
          userId,
          title: text.title,
          body: text.body,
          data: toPushData(notification.data),
          collapseKey: notification.fingerprint ?? undefined,
        },
        { jobId: `push_send.${receipt.id}` },
      );
      // No Redis (local dev). Unlike email there is no synchronous
      // fallback: a push needs credentials a dev machine will not
      // have, and pretending otherwise would hide the real state.
      delivered.push = enqueued === null ? 'skipped:no_queue' : 'queued';
    }

    // ── sms ── Stubbed until that worker ships.
    delivered.sms = channels.sms
      ? 'skipped:not_implemented'
      : 'skipped:preference_off';

    receipt.deliveredChannels = delivered;
    await receipt.save();

    return { receipt, delivered };
  }

  /**
   * Build the CTA URL for the email channel from notification.data.
   * Returns undefined when there's nothing to link to.
   *
   * Mirrors the FE bell handler's logic: path segments come from
   * `screen` + optional `entityId`; tabbed pages forward `queryParams`
   * (e.g. `/profile?tab=memberships`) which can't be expressed via path.
   */
  private buildCtaUrl(data: NotificationData | null): string | undefined {
    if (!data?.screen) return undefined;
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') || 'http://localhost:4200';
    const segments = [data.screen];
    if (data.entityId) segments.push(data.entityId);
    let url = `${frontendUrl}/${segments.join('/')}`;
    const qp = data.queryParams;
    if (qp && typeof qp === 'object') {
      const params = new URLSearchParams();
      for (const [k, v] of Object.entries(qp)) {
        if (typeof v === 'string') params.append(k, v);
      }
      const qs = params.toString();
      if (qs) url = `${url}?${qs}`;
    }
    return url;
  }
}

/**
 * Flatten a deep-link payload for transport.
 *
 * Both APNs and FCM restrict custom keys to strings, so the nested
 * `queryParams` object is folded into flat `qp_*` keys. The mobile
 * app's deep-link resolver reads `screen`, `entityId` and the query
 * params, which is exactly what survives this.
 */
function toPushData(
  data: NotificationData | null,
): Record<string, string> | undefined {
  if (!data?.screen) return undefined;

  const flat: Record<string, string> = { screen: data.screen };
  if (data.entityId) flat.entityId = data.entityId;

  const qp = data.queryParams;
  if (qp && typeof qp === 'object') {
    for (const [key, value] of Object.entries(qp)) {
      if (typeof value === 'string') flat[`qp_${key}`] = value;
    }
  }

  return flat;
}
