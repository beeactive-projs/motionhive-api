import { Injectable, Inject } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Transaction, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
// Type namespace via path-aliased ambient — see stripe.service.ts.
import type { Stripe } from 'stripe-types';
import {
  WebhookEvent,
  WebhookEventStatus,
} from '../entities/webhook-event.entity';
import { StripeService } from './stripe.service';
import { ConnectService } from './connect.service';
import { InvoiceService } from './invoice.service';
import { SubscriptionService } from './subscription.service';
import { RefundService } from './refund.service';
import { DisputeService } from './dispute.service';
import { OrphanedWebhookError } from './webhook-errors';
import { NotificationService } from '../../notification/notification.service';
import { NotificationOutbox } from '../../notification/notification-outbox';
import { JobsService } from '../../jobs/jobs.service';

/** Orphaned rows older than this are abandoned (FAILED) by reconciliation. */
const ORPHAN_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

export interface WebhookProcessResult {
  eventId: string;
  type: string;
  /** True when this is a Stripe redelivery of an already-seen event. */
  duplicate: boolean;
  status: WebhookEventStatus;
}

/**
 * Single entry point for Stripe webhook processing. Idempotent via
 * `webhook_event.UNIQUE(stripe_event_id)`; dispatches to the right
 * service inside a transaction; defers notifications to a
 * post-commit outbox.
 *
 * SECURITY: log event.id and event.type only. NEVER log
 * event.data.object — it contains PII (email, last4, address).
 *
 * Race: a webhook for an entity whose local row hasn't committed yet
 * is stamped ORPHANED. A reconciliation sweep revisits later. Rare
 * because creators commit before returning the Stripe URL.
 */
@Injectable()
export class WebhookHandlerService {
  // Event types we actively handle. Anything else is stored as
  // IGNORED for audit and acked with 200.
  private readonly handledEventTypes = new Set<string>([
    // Connect
    'account.updated',
    'account.application.deauthorized',
    'capability.updated',
    // Invoices
    'invoice.created',
    'invoice.finalized',
    'invoice.paid',
    'invoice.payment_failed',
    'invoice.voided',
    // Subscriptions
    'customer.subscription.created',
    'customer.subscription.updated',
    'customer.subscription.deleted',
    'customer.subscription.trial_will_end',
    // Payments
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'charge.refunded',
    'charge.dispute.created',
    // Without these the local row stayed `needs_response` for ever: the
    // deadline cron kept reminding about settled disputes, and account
    // deletion would have treated them as open.
    'charge.dispute.updated',
    'charge.dispute.closed',
    // Payouts
    'payout.paid',
    'payout.failed',
  ]);

  constructor(
    @InjectModel(WebhookEvent)
    private readonly webhookEventModel: typeof WebhookEvent,
    private readonly sequelize: Sequelize,
    private readonly stripeService: StripeService,
    private readonly connectService: ConnectService,
    private readonly invoiceService: InvoiceService,
    private readonly subscriptionService: SubscriptionService,
    private readonly refundService: RefundService,
    private readonly disputeService: DisputeService,
    private readonly notificationService: NotificationService,
    private readonly jobs: JobsService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Main entry point.
   *
   * @param rawBody         the untouched request Buffer (preserved by
   *                        express.raw middleware — DO NOT stringify)
   * @param signatureHeader value of the stripe-signature header
   */
  async handleIncomingEvent(
    rawBody: Buffer,
    signatureHeader: string,
  ): Promise<WebhookProcessResult> {
    // ─────────────────────────────────────────────────────────────
    // 1. Verify signature. Let the signature error propagate — the
    //    controller catches it and returns HTTP 400.
    // ─────────────────────────────────────────────────────────────
    const event = this.stripeService.verifyWebhookSignature(
      rawBody,
      signatureHeader,
    );

    this.logger.log(
      `Stripe webhook received: ${event.type} (${event.id})`,
      'WebhookHandlerService',
    );

    // ─────────────────────────────────────────────────────────────
    // 2. Idempotency checkpoint — INSERT-first, conflict-aware.
    //
    //    We attempt the INSERT directly and rely on the
    //    UNIQUE(stripe_event_id) index to atomically reject duplicates.
    //    A plain "findOne → create" check has a TOCTOU window where
    //    two concurrent deliveries can both pass the findOne and then
    //    both attempt the insert; one gets a UniqueConstraintError.
    //    Catching that error and fetching the existing row closes the
    //    window and makes duplicate handling safe under concurrency.
    // ─────────────────────────────────────────────────────────────
    let auditRow: WebhookEvent;
    try {
      auditRow = await this.webhookEventModel.create({
        stripeEventId: event.id,
        type: event.type,
        apiVersion: event.api_version ?? null,
        payload: event.data.object as unknown as Record<string, unknown>,
        status: WebhookEventStatus.PROCESSING,
      });
    } catch (err) {
      if (err instanceof UniqueConstraintError) {
        const existing = await this.webhookEventModel.findOne({
          where: { stripeEventId: event.id },
        });
        if (!existing) {
          // Should never happen — we just hit the unique constraint.
          throw err;
        }
        this.logger.log(
          `Duplicate webhook skipped: ${event.type} (${event.id})`,
          'WebhookHandlerService',
        );
        return {
          eventId: event.id,
          type: event.type,
          duplicate: true,
          status: existing.status,
        };
      }
      throw err;
    }

    // ─────────────────────────────────────────────────────────────
    // 3. Dispatch
    //
    //    Unhandled event types are recorded as IGNORED outside a
    //    transaction — there is no handler work to roll back.
    // ─────────────────────────────────────────────────────────────
    if (!this.handledEventTypes.has(event.type)) {
      auditRow.status = WebhookEventStatus.IGNORED;
      auditRow.processedAt = new Date();
      await auditRow.save();
      return {
        eventId: event.id,
        type: event.type,
        duplicate: false,
        status: WebhookEventStatus.IGNORED,
      };
    }

    // ─────────────────────────────────────────────────────────────
    // 4. Hand off processing to the `payments` queue and ack fast.
    //
    //    The row is already persisted (idempotency checkpoint), so the
    //    worker owns retries. When Redis isn't configured, `enqueue`
    //    returns null — we fall back to processing inline so webhooks
    //    still work in local dev (and the controller's 200/500 still
    //    reflects the real outcome, preserving Stripe retries).
    // ─────────────────────────────────────────────────────────────
    const enqueued = await this.jobs.enqueue(
      'payments.process_webhook',
      {
        webhookEventId: auditRow.id,
        event: event as unknown as Record<string, unknown>,
      },
      { jobId: `webhook-${event.id}`, attempts: 5 },
    );

    if (enqueued) {
      return {
        eventId: event.id,
        type: event.type,
        duplicate: false,
        status: WebhookEventStatus.PROCESSING,
      };
    }

    // Inline fallback (no Redis): process synchronously. Lets the
    // OrphanedWebhookError → 200 and FAILED → throw(500) semantics flow
    // through to the controller exactly as before.
    await this.processEvent(event, auditRow);
    return {
      eventId: event.id,
      type: event.type,
      duplicate: false,
      status: auditRow.status,
    };
  }

  /**
   * Process a webhook the worker pulled off the queue. Loads the audit
   * row, reconstructs nothing (the full event rides in the job payload),
   * and runs `processEvent`. Idempotent: a row already PROCESSED is a
   * no-op (covers BullMQ retries + Stripe redelivery races).
   */
  async processQueued(
    webhookEventId: string,
    event: Stripe.Event,
  ): Promise<void> {
    const auditRow = await this.webhookEventModel.findByPk(webhookEventId);
    if (!auditRow) {
      this.logger.warn(
        `process_webhook: audit row ${webhookEventId} not found`,
        'WebhookHandlerService',
      );
      return;
    }
    if (auditRow.status === WebhookEventStatus.PROCESSED) return;
    await this.processEvent(event, auditRow);
  }

  /**
   * The unit of work: dispatch inside a transaction, flush the outbox on
   * commit, and stamp the audit row. Shared by the queue worker, the
   * inline (no-Redis) fallback, and the reconciliation sweep.
   *
   * On `OrphanedWebhookError` the row is stamped ORPHANED and the method
   * returns (no throw) — the job/worker treats this as success and the
   * reconciliation sweep revisits. Any other error rethrows so BullMQ
   * (or the controller, inline) retries.
   */
  private async processEvent(
    event: Stripe.Event,
    auditRow: WebhookEvent,
  ): Promise<void> {
    if (auditRow.status === WebhookEventStatus.PROCESSED) return;

    const outbox = new NotificationOutbox(
      this.notificationService,
      this.logger,
    );
    try {
      await this.sequelize.transaction(async (tx) => {
        await this.dispatchHandler(event, tx, outbox);
        auditRow.status = WebhookEventStatus.PROCESSED;
        auditRow.processedAt = new Date();
        await auditRow.save({ transaction: tx });
      });
      await outbox.flush();
    } catch (err) {
      outbox.discard();
      if (err instanceof OrphanedWebhookError) {
        this.logger.warn(
          `Webhook orphaned: ${event.type} (${event.id}) — ${err.message}`,
          'WebhookHandlerService',
        );
        auditRow.status = WebhookEventStatus.ORPHANED;
        auditRow.error = err.message;
        await auditRow.save();
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Webhook handler failed for ${event.type} (${event.id}): ${message}`,
        err instanceof Error ? err.stack : undefined,
        'WebhookHandlerService',
      );
      auditRow.status = WebhookEventStatus.FAILED;
      auditRow.error = message;
      await auditRow.save();
      throw err;
    }
  }

  /**
   * Reconciliation sweep (`payments.reconcile_webhooks` cron): revisit
   * ORPHANED rows. Those still within the window are re-processed (the
   * originating local row may have since committed); rows older than
   * `ORPHAN_MAX_AGE_MS` are abandoned as FAILED so they stop being swept.
   */
  async reconcileOrphaned(
    now: Date,
  ): Promise<{ resolved: number; agedOut: number; stillOrphaned: number }> {
    const rows = await this.webhookEventModel.findAll({
      where: { status: WebhookEventStatus.ORPHANED },
    });

    let resolved = 0;
    let agedOut = 0;
    let stillOrphaned = 0;
    for (const row of rows) {
      const age = now.getTime() - new Date(row.receivedAt).getTime();
      if (age > ORPHAN_MAX_AGE_MS) {
        row.status = WebhookEventStatus.FAILED;
        row.error = 'Orphaned webhook aged out without a local row appearing.';
        await row.save();
        agedOut += 1;
        continue;
      }
      // Reconstruct the minimal event from the stored payload. Orphan-prone
      // handlers only read `event.data.object`, so this is sufficient.
      const event = {
        id: row.stripeEventId,
        type: row.type,
        data: { object: row.payload },
      } as unknown as Stripe.Event;
      await this.processEvent(event, row);
      if (row.status === WebhookEventStatus.PROCESSED) resolved += 1;
      else stillOrphaned += 1;
    }

    if (rows.length > 0) {
      this.logger.log(
        `Webhook reconciliation: resolved=${resolved} agedOut=${agedOut} stillOrphaned=${stillOrphaned}`,
        'WebhookHandlerService',
      );
    }
    return { resolved, agedOut, stillOrphaned };
  }

  /** Route an event to the right handler. */
  private async dispatchHandler(
    event: Stripe.Event,
    tx: Transaction,
    outbox: NotificationOutbox,
  ): Promise<void> {
    switch (event.type) {
      // capability.updated piggybacks on account.updated — both feed
      // the same sync routine; the latter handler re-fetches the full
      // account when only a capability is in the payload.
      case 'account.updated':
      case 'capability.updated':
        await this.handleAccountUpdated(event, tx, outbox);
        break;

      case 'account.application.deauthorized':
        await this.handleAccountDeauthorized(event, tx, outbox);
        break;

      case 'invoice.created':
      case 'invoice.finalized':
      case 'invoice.paid':
      case 'invoice.voided':
        await this.invoiceService.syncFromStripeInvoice(
          event.data.object,
          tx,
          outbox,
        );
        break;

      case 'invoice.payment_failed':
        await this.invoiceService.handlePaymentFailed(
          event.data.object,
          tx,
          outbox,
        );
        break;

      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
        await this.invoiceService.syncPaymentFromIntent(event.data.object, tx);
        break;

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.trial_will_end':
        await this.subscriptionService.syncFromWebhook(
          event.data.object,
          tx,
          outbox,
        );
        break;

      case 'charge.refunded':
        await this.refundService.syncRefundFromWebhook(
          event.data.object,
          tx,
          outbox,
        );
        break;

      case 'charge.dispute.created':
        await this.disputeService.syncFromWebhook(
          event.data.object,
          tx,
          outbox,
        );
        break;

      case 'charge.dispute.updated':
      case 'charge.dispute.closed':
        await this.disputeService.syncFromWebhook(
          event.data.object,
          tx,
          outbox,
          { onlyExisting: true },
        );
        break;

      case 'payout.paid':
      case 'payout.failed':
        // Logged-only for now; no domain side effects.
        this.logger.log(
          `Event ${event.type} accepted (${event.id})`,
          'WebhookHandlerService',
        );
        break;

      default:
        // Unreachable — handledEventTypes is the source of truth.
        break;
    }
  }

  // === Connect onboarding handlers ===

  /**
   * account.updated / capability.updated — keep the local stripe_account
   * mirror in sync with Stripe (charges_enabled, payouts_enabled,
   * requirements). Delegates to ConnectService inside the same transaction
   * so a failed sync rolls back the webhook_event status update too.
   *
   * For `account.updated`, event.data.object IS the full Stripe.Account.
   * For `capability.updated`, event.data.object is a Stripe.Capability and
   * we re-fetch the parent account from Stripe to get the full state.
   */
  private async handleAccountUpdated(
    event: Stripe.Event,
    tx: Transaction,
    outbox: NotificationOutbox,
  ): Promise<void> {
    if (event.type === 'capability.updated') {
      const capability = event.data.object;
      const accountId =
        typeof capability.account === 'string'
          ? capability.account
          : capability.account?.id;
      if (!accountId) {
        this.logger.warn(
          `capability.updated missing account reference (${event.id})`,
          'WebhookHandlerService',
        );
        return;
      }
      const fullAccount =
        await this.stripeService.stripe.accounts.retrieve(accountId);
      await this.connectService.syncAccountFromWebhook(fullAccount, tx, outbox);
      return;
    }

    const account = event.data.object as Stripe.Account;
    await this.connectService.syncAccountFromWebhook(account, tx, outbox);
  }

  /**
   * account.application.deauthorized — instructor revoked our OAuth grant.
   * The connected account id is on `event.account` (top-level field on
   * Connect events), not in `event.data.object`.
   */
  private async handleAccountDeauthorized(
    event: Stripe.Event,
    tx: Transaction,
    outbox: NotificationOutbox,
  ): Promise<void> {
    const accountId = event.account;
    if (!accountId) {
      this.logger.warn(
        `account.application.deauthorized missing event.account (${event.id})`,
        'WebhookHandlerService',
      );
      return;
    }
    await this.connectService.handleDeauthorized(accountId, tx, outbox);
  }
}
