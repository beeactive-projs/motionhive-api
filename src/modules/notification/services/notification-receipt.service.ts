import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { literal, Op } from 'sequelize';
import {
  buildPaginatedResponse,
  PaginatedResponse,
  getOffset,
} from '../../../common/dto/pagination.dto';
import {
  Notification,
  NotificationData,
  NotificationSeverity,
} from '../entities/notification.entity';
import { NotificationReceipt } from '../entities/notification-receipt.entity';
import {
  CATEGORY_TO_TYPES,
  NotificationCategory,
  TYPE_TO_CATEGORY,
} from '../notification-categories';
import { NotificationType } from '../notification-types';

/**
 * Shape returned to the FE — flattens the (notification + receipt)
 * join into a single object so the bell component doesn't have to
 * navigate two levels of nesting.
 *
 * `id` here is the **receipt id**, not the notification id. The FE
 * mark-read / dismiss / delete endpoints all key off this.
 */
export interface BellNotification {
  id: string;
  notificationId: string;
  type: string;
  /**
   * Derived from `type` via TYPE_TO_CATEGORY. Sent because the client has no
   * way to map 47 types onto 8 categories, and it drives both the category
   * filter and the per-category icon on a row.
   */
  category: NotificationCategory;
  title: string;
  body: string;
  data: NotificationData | null;
  severity: NotificationSeverity;
  iconUrl: string | null;
  priority: number;
  deliveredAt: Date | null;
  viewedAt: Date | null;
  readAt: Date | null;
  clickedAt: Date | null;
  dismissedAt: Date | null;
  createdAt: Date;
}

export interface ListReceiptsOptions {
  page: number;
  limit: number;
  /** Narrow to a single category. Omit for everything. */
  category?: NotificationCategory;
  unreadOnly?: boolean;
}

/**
 * NotificationReceiptService
 *
 * The FE-facing read/mutate API for the bell + history. Producers
 * write through `NotificationService.notify()`; the FE reads through
 * here.
 *
 * Ownership is enforced at the query level: every method takes
 * `userId` and only operates on rows owned by that user. A 404 is
 * returned for cross-user access (we don't leak existence with 403).
 */
@Injectable()
export class NotificationReceiptService {
  constructor(
    @InjectModel(NotificationReceipt)
    private readonly receiptModel: typeof NotificationReceipt,
    @InjectModel(Notification)
    private readonly notificationModel: typeof Notification,
  ) {}

  /**
   * Bell list query. Filters out expired alerts and (when set) alerts
   * scheduled for the future. Newest first.
   *
   * Also hides receipts whose in-app channel was suppressed at notify
   * time — e.g. MESSAGE_RECEIVED, which writes a receipt for the
   * email-worker dedup key but never wants to appear in the bell
   * (the Messages sidebar badge is the persistent in-app signal).
   */
  async listForUser(
    userId: string,
    opts: ListReceiptsOptions,
  ): Promise<PaginatedResponse<BellNotification>> {
    const receiptWhere: Record<string, unknown> = {
      userId,
      ...this.bellVisibleClause(),
    };
    if (opts.unreadOnly) {
      receiptWhere.readAt = { [Op.is]: null };
      receiptWhere.dismissedAt = { [Op.is]: null };
    }

    // Category is a property of the type, not a column, so it filters as the
    // set of types that map to it. Keeps the paging honest — filtering after
    // the query would return short pages.
    const typeFilter = opts.category ? CATEGORY_TO_TYPES[opts.category] : null;

    const { rows, count } = await this.receiptModel.findAndCountAll({
      where: receiptWhere,
      include: [this.activeNotificationInclude(typeFilter ?? undefined)],
      order: [['createdAt', 'DESC']],
      limit: opts.limit,
      offset: getOffset(opts.page, opts.limit),
    });

    const items = rows.map((r) => this.toBellShape(r));
    return buildPaginatedResponse(items, count, opts.page, opts.limit);
  }

  /**
   * Bell badge: unread count for the user. Filters mirror listForUser
   * (visibility window via the joined notification + in-app channel
   * delivered) so the badge stays accurate.
   */
  async unreadCount(userId: string): Promise<number> {
    return this.receiptModel.count({
      where: {
        userId,
        readAt: { [Op.is]: null },
        dismissedAt: { [Op.is]: null },
        ...this.bellVisibleClause(),
      },
      include: [this.activeNotificationInclude()],
    });
  }

  /**
   * Shared `WHERE` fragment for bell queries: only show receipts that
   * actually delivered an in-app channel. Receipts created with
   * `channelOverride.in_app = false` (currently: MESSAGE_RECEIVED)
   * have `delivered_channels.in_app === 'skipped:preference_off'`
   * and must NOT appear in the bell or the unread count.
   *
   * The JSON predicate uses Postgres' `->>` operator. If we ever move
   * the receipt store off Postgres this fragment needs revisiting.
   */
  private bellVisibleClause(): Record<string, unknown> {
    return {
      [Op.and]: literal(`delivered_channels->>'in_app' = 'sent'`),
    };
  }

  /**
   * Shared `include` clause for the bell queries: only join
   * notifications that are currently visible (deliver_at <= now AND
   * (expire_at IS NULL OR expire_at > now)). Built per-call so `now`
   * is fresh — Sequelize freezes literal values at expression build
   * time, not at query execution time.
   */
  private activeNotificationInclude(types?: readonly NotificationType[]) {
    const now = new Date();
    return {
      model: this.notificationModel,
      required: true,
      where: {
        [Op.and]: [
          // A category filter is expressed as its set of types — category is
          // a property of the type, not a column.
          ...(types ? [{ type: { [Op.in]: types as string[] } }] : []),
          {
            [Op.or]: [
              { deliverAt: { [Op.is]: null } },
              { deliverAt: { [Op.lte]: now } },
            ],
          },
          {
            [Op.or]: [
              { expireAt: { [Op.is]: null } },
              { expireAt: { [Op.gt]: now } },
            ],
          },
        ],
      },
    };
  }

  async markAsRead(userId: string, receiptId: string): Promise<void> {
    const receipt = await this.findOwnedOrThrow(userId, receiptId);
    if (!receipt.readAt) {
      receipt.readAt = new Date();
      await receipt.save();
    }
  }

  /**
   * The undo for markAsRead — "I opened that by accident, put it back".
   * Clears `clicked_at` too, otherwise a row can be unread and clicked at
   * once, which reads as a bug in the analytics funnel.
   */
  async markAsUnread(userId: string, receiptId: string): Promise<void> {
    const receipt = await this.findOwnedOrThrow(userId, receiptId);
    if (receipt.readAt) {
      receipt.readAt = null;
      receipt.clickedAt = null;
      await receipt.save();
    }
  }

  async markAllAsRead(userId: string): Promise<{ updated: number }> {
    const [updated] = await this.receiptModel.update(
      { readAt: new Date() },
      {
        where: {
          userId,
          readAt: { [Op.is]: null },
        },
      },
    );
    return { updated };
  }

  /**
   * Mark a batch of receipts as viewed. Called by the FE when the
   * bell dropdown opens — we want the analytics signal but not the
   * "mark read" implication.
   */
  async markAsViewed(
    userId: string,
    receiptIds: string[],
  ): Promise<{ updated: number }> {
    if (receiptIds.length === 0) return { updated: 0 };
    const [updated] = await this.receiptModel.update(
      { viewedAt: new Date() },
      {
        where: {
          id: { [Op.in]: receiptIds },
          userId,
          viewedAt: { [Op.is]: null },
        },
      },
    );
    return { updated };
  }

  /**
   * Set clicked_at + read_at in one shot. The FE calls this when the
   * user clicks through to the deep-linked screen.
   */
  async markAsClicked(userId: string, receiptId: string): Promise<void> {
    const receipt = await this.findOwnedOrThrow(userId, receiptId);
    const now = new Date();
    if (!receipt.clickedAt) receipt.clickedAt = now;
    if (!receipt.readAt) receipt.readAt = now;
    await receipt.save();
  }

  async dismiss(userId: string, receiptId: string): Promise<void> {
    const receipt = await this.findOwnedOrThrow(userId, receiptId);
    if (!receipt.dismissedAt) {
      receipt.dismissedAt = new Date();
      await receipt.save();
    }
  }

  /**
   * Hard delete — receipts have no audit value once the user wants
   * them gone. Re-shows are achieved by emitting a fresh notification.
   */
  async remove(userId: string, receiptId: string): Promise<void> {
    const deleted = await this.receiptModel.destroy({
      where: { id: receiptId, userId },
    });
    if (deleted === 0) {
      throw new NotFoundException('Notification not found');
    }
  }

  /**
   * Record the per-channel outcome for a receipt. Used by workers
   * (Phase 6+) to update `delivered_channels` after async delivery
   * completes — e.g. the email worker writes `email: 'sent'` or
   * `email: 'failed:resend timeout'` here when its job finishes.
   *
   * Merges with the existing JSONB so other channel results (in_app,
   * push, sms) aren't clobbered by a single channel's update.
   *
   * Silently no-ops when the receipt no longer exists (the user
   * deleted it before the worker finished). The worker shouldn't
   * fail just because a row is gone.
   */
  async recordChannelOutcome(
    receiptId: string,
    channel: 'in_app' | 'email' | 'push' | 'sms',
    outcome: string,
  ): Promise<void> {
    const receipt = await this.receiptModel.findByPk(receiptId);
    if (!receipt) return;
    const next = { ...receipt.deliveredChannels, [channel]: outcome };
    receipt.deliveredChannels = next;
    await receipt.save();
  }

  /**
   * Has the given channel already been successfully delivered for
   * this receipt? Used by workers to short-circuit a retry that
   * would otherwise re-send (Resend has no idempotency key, so we
   * dedupe at the receipt level).
   *
   * Treats only the literal `'sent'` outcome as delivered — `'queued'`
   * means we tried to enqueue but never saw the worker confirm, and
   * `'failed:...'` means the worker should retry.
   */
  async isChannelDelivered(
    receiptId: string,
    channel: 'in_app' | 'email' | 'push' | 'sms',
  ): Promise<boolean> {
    const receipt = await this.receiptModel.findByPk(receiptId);
    if (!receipt) return false;
    return receipt.deliveredChannels?.[channel] === 'sent';
  }

  private async findOwnedOrThrow(
    userId: string,
    receiptId: string,
  ): Promise<NotificationReceipt> {
    const receipt = await this.receiptModel.findOne({
      where: { id: receiptId, userId },
    });
    if (!receipt) {
      // 404 (not 403) — don't leak existence of receipts owned by others.
      throw new NotFoundException('Notification not found');
    }
    return receipt;
  }

  private toBellShape(receipt: NotificationReceipt): BellNotification {
    const n = receipt.notification;
    return {
      id: receipt.id,
      notificationId: n.id,
      type: n.type,
      // `type` is a plain varchar in the DB, so a row written before a type
      // was renamed (or by a migration/seed) can miss the map. Account is the
      // catch-all rather than sending undefined at a non-optional field.
      category:
        TYPE_TO_CATEGORY[n.type as NotificationType] ??
        NotificationCategory.Account,
      title: n.title,
      body: n.body,
      data: n.data,
      severity: n.severity,
      iconUrl: n.iconUrl,
      priority: n.priority,
      deliveredAt: receipt.deliveredAt,
      viewedAt: receipt.viewedAt,
      readAt: receipt.readAt,
      clickedAt: receipt.clickedAt,
      dismissedAt: receipt.dismissedAt,
      createdAt: receipt.createdAt,
    };
  }
}
