import { Injectable, Inject } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

/**
 * Notification types matching the notification system plan.
 * Each type maps to a specific event in the platform.
 */
export enum NotificationType {
  SESSION_REMINDER_24H = 'SESSION_REMINDER_24H',
  SESSION_REMINDER_1H = 'SESSION_REMINDER_1H',
  SESSION_CANCELLED = 'SESSION_CANCELLED',
  SESSION_RESCHEDULED = 'SESSION_RESCHEDULED',
  SESSION_STATUS_CHANGED = 'SESSION_STATUS_CHANGED',
  PARTICIPANT_JOINED = 'PARTICIPANT_JOINED',
  PARTICIPANT_LEFT = 'PARTICIPANT_LEFT',
  CLIENT_REQUEST_RECEIVED = 'CLIENT_REQUEST_RECEIVED',
  CLIENT_REQUEST_ACCEPTED = 'CLIENT_REQUEST_ACCEPTED',
  CLIENT_INVITATION_RECEIVED = 'CLIENT_INVITATION_RECEIVED',
  GROUP_INVITATION_RECEIVED = 'GROUP_INVITATION_RECEIVED',
  GROUP_INVITATION_ACCEPTED = 'GROUP_INVITATION_ACCEPTED',
  GROUP_MEMBER_JOINED = 'GROUP_MEMBER_JOINED',
  GROUP_MEMBER_LEFT = 'GROUP_MEMBER_LEFT',
  // ── Payments & Invoicing ─────────────────────────────────
  INVOICE_CREATED = 'INVOICE_CREATED',
  INVOICE_DUE_SOON = 'INVOICE_DUE_SOON',
  INVOICE_OVERDUE = 'INVOICE_OVERDUE',
  INVOICE_PAID = 'INVOICE_PAID',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  SUBSCRIPTION_CREATED = 'SUBSCRIPTION_CREATED',
  SUBSCRIPTION_CANCELED = 'SUBSCRIPTION_CANCELED',
  PAYOUT_SENT = 'PAYOUT_SENT',
  STRIPE_ACCOUNT_READY = 'STRIPE_ACCOUNT_READY',
  STRIPE_ACCOUNT_RESTRICTED = 'STRIPE_ACCOUNT_RESTRICTED',
  DISPUTE_OPENED = 'DISPUTE_OPENED',
  REFUND_ISSUED = 'REFUND_ISSUED',
  // ── Posts ────────────────────────────────────────────────
  POST_NEW_COMMENT = 'POST_NEW_COMMENT',
  POST_PENDING_APPROVAL = 'POST_PENDING_APPROVAL',
  POST_APPROVED = 'POST_APPROVED',
  POST_REJECTED = 'POST_REJECTED',
}

export interface NotifyParams {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  data?: {
    screen: string;
    entityId?: string;
    action?: string;
  };
}

/**
 * Notification Service (Phase 1 — Dummy/Logger)
 *
 * Provides a unified notification interface that other services call.
 * Currently logs notifications. When the full notification system is built
 * (see NOTIFICATION_SYSTEM_PLAN.md), this will:
 * 1. Store in-app notifications in DB
 * 2. Check user preferences
 * 3. Deliver via email/push/in-app
 *
 * Usage from other services:
 *   this.notificationService.notify({
 *     userId: 'target-user-id',
 *     type: NotificationType.SESSION_CANCELLED,
 *     title: 'Session Cancelled',
 *     body: 'Your session "Morning Yoga" has been cancelled.',
 *     data: { screen: 'session-detail', entityId: sessionId },
 *   });
 */
@Injectable()
export class NotificationService {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Send a notification to a single user.
   * Phase 1: Logs only. Phase 2+: stores in DB, checks preferences, delivers.
   */
  notify(params: NotifyParams): Promise<void> {
    this.logger.log(
      `[NOTIFICATION] ${params.type} → user:${params.userId} | ${params.title}`,
      'NotificationService',
    );
    // TODO: Phase 2 — Store in notification table
    // TODO: Phase 2 — Check preferences and deliver via email/push
    return Promise.resolve();
  }

  /**
   * Send a notification to multiple users (e.g., all session participants).
   * Phase 1: Logs only.
   */
  notifyMany(
    userIds: string[],
    params: Omit<NotifyParams, 'userId'>,
  ): Promise<void> {
    this.logger.log(
      `[NOTIFICATION] ${params.type} → ${userIds.length} users | ${params.title}`,
      'NotificationService',
    );
    // TODO: Phase 2 — Batch insert notifications + batch deliver
    return Promise.resolve();
  }
}
