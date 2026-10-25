import { Inject } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { toLocale } from '../../../../common/i18n';
import { EmailService } from '../../../../common/services/email.service';
import { MessagingService } from '../../../messaging/messaging.service';
import { PushDeliveryService } from '../../../notification/push/push-delivery.service';
import { NotificationReceiptService } from '../../../notification/services/notification-receipt.service';
import { JobHandler, MultiJobWorker } from '../../common/multi-job.worker';
import { JobContext } from '../../common/job-context';
import { TemporaryError } from '../../common/errors';
import { JobPayload, QueueName } from '../../job-registry';

/**
 * Every job on the notifications queue: one delivery channel each.
 *
 * Replaces the single-job `EmailSendWorker`. BullMQ allows one
 * `@Processor` per queue, so the moment the queue grew a second job
 * this had to become the processor-per-queue shape the sessions,
 * workouts, payments and maintenance queues already use.
 *
 * Both handlers follow the same contract:
 *   - Skip if the channel already succeeded for this receipt. BullMQ's
 *     jobId dedupe covers a re-enqueue, not a post-failure retry, and
 *     neither Resend nor APNs offers an idempotency key.
 *   - Record the outcome on the receipt either way, so "did it
 *     actually go out?" is answerable later.
 *   - Throw `TemporaryError` only when another attempt could succeed.
 */
@Processor(QueueName.Notifications)
export class NotificationsWorker extends MultiJobWorker {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    logger: LoggerService,
    private readonly emailService: EmailService,
    private readonly pushDelivery: PushDeliveryService,
    private readonly receiptService: NotificationReceiptService,
    private readonly messagingService: MessagingService,
  ) {
    super(logger);
  }

  protected readonly handlers: Record<string, JobHandler> = {
    email_send: (payload, ctx) =>
      this.emailSend(payload as JobPayload<'notifications.email_send'>, ctx),
    push_send: (payload, ctx) =>
      this.pushSend(payload as JobPayload<'notifications.push_send'>, ctx),
  };

  private async emailSend(
    payload: JobPayload<'notifications.email_send'>,
    ctx: JobContext,
  ): Promise<void> {
    const alreadySent = await this.receiptService.isChannelDelivered(
      payload.receiptId,
      'email',
    );
    if (alreadySent) {
      ctx.log.log(
        `email skip (already delivered) receipt=${payload.receiptId}`,
      );
      return;
    }

    const status = await this.emailService.sendNotificationEmail({
      to: payload.to,
      title: payload.title,
      body: payload.body,
      locale: toLocale(payload.locale),
      ctaUrl: payload.ctaUrl,
      ctaLabel: payload.ctaLabel,
    });

    if (status.ok) {
      await this.receiptService.recordChannelOutcome(
        payload.receiptId,
        'email',
        'sent',
      );
      ctx.log.log(`email sent to ${payload.to}`);
      return;
    }

    await this.receiptService.recordChannelOutcome(
      payload.receiptId,
      'email',
      `failed:${status.reason.slice(0, 200)}`,
    );

    // Resend's failure modes are mostly rate limits and 5xx blips,
    // both worth retrying.
    throw new TemporaryError(`resend send failed: ${status.reason}`);
  }

  private async pushSend(
    payload: JobPayload<'notifications.push_send'>,
    ctx: JobContext,
  ): Promise<void> {
    const alreadySent = await this.receiptService.isChannelDelivered(
      payload.receiptId,
      'push',
    );
    if (alreadySent) {
      ctx.log.log(`push skip (already delivered) receipt=${payload.receiptId}`);
      return;
    }

    const outcome = await this.pushDelivery.deliver(payload.userId, {
      title: payload.title,
      body: payload.body,
      data: payload.data,
      collapseKey: payload.collapseKey,
      badge: await this.badgeCount(payload.userId, ctx),
    });

    await this.pushDelivery.recordOutcome(payload.receiptId, outcome);

    if (outcome.sent > 0) {
      ctx.log.log(
        `push sent user=${payload.userId} devices=${outcome.sent}` +
          (outcome.revoked > 0 ? ` revoked=${outcome.revoked}` : ''),
      );
      return;
    }

    // Nothing landed. Retry only when something might change: a
    // user with no devices, or tokens we have just revoked, will
    // still have none on the next attempt.
    if (outcome.retryable) {
      throw new TemporaryError(
        `push failed for user=${payload.userId}: ${outcome.reason ?? 'unknown'}`,
      );
    }

    ctx.log.log(
      `push not delivered user=${payload.userId} reason=${outcome.reason ?? 'unknown'} (not retrying)`,
    );
  }

  /**
   * The app icon number: unread messages plus unread bell notifications,
   * the same two counts the app shows. Read at send time, not enqueue
   * time, so a retried job carries the current number. A message never
   * counts twice: its receipt has in-app off, which the bell count skips.
   *
   * A failed count sends the push without a number (iOS keeps the last
   * one) rather than holding the alert back.
   */
  private async badgeCount(
    userId: string,
    ctx: JobContext,
  ): Promise<number | undefined> {
    try {
      const [messages, notifications] = await Promise.all([
        this.messagingService.getUnreadCount(userId),
        this.receiptService.unreadCount(userId),
      ]);
      return messages.count + notifications;
    } catch (err) {
      ctx.log.warn(
        `badge count failed user=${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return undefined;
    }
  }
}
