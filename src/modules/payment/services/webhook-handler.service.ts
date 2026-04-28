import { Injectable, Inject } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Transaction, UniqueConstraintError } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
// See stripe.service.ts for why we pull the type namespace from a
// path-aliased ambient instead of the package root.
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
import { OrphanedWebhookError } from './webhook-errors';

/**
 * Result of processing a webhook, returned to the controller so it
 * can set the right HTTP status code.
 */
export interface WebhookProcessResult {
  /** The Stripe event id (evt_...) — useful for logging. */
  eventId: string;
  /** The Stripe event type (e.g. 'invoice.paid'). */
  type: string;
  /** Whether this was a first-time delivery vs. a Stripe retry. */
  duplicate: boolean;
  /** Final processing status. */
  status: WebhookEventStatus;
}

/**
 * WebhookHandlerService
 *
 * The single entry point for processing a Stripe webhook delivery.
 * Called by PaymentWebhookController after signature verification.
 *
 * Responsibilities:
 * 1. Idempotency — insert into webhook_event, conflict → skip
 * 2. Dispatch the event to the right handler
 * 3. Transaction scoping — DB writes inside, side effects after
 *    commit (emails + in-app notifications happen post-commit so a
 *    failed email never leaves the DB inconsistent)
 * 4. Update webhook_event row with the final status
 *
 * LOGGING POLICY (SECURITY-CRITICAL):
 *   Log event.id and event.type ONLY. NEVER log event.data.object —
 *   it contains PII (customer email, name, card last4, address).
 *   This rule applies to Winston AND any APM SDK that may be added
 *   later.
 *
 * Race-condition note: when a webhook arrives BEFORE the originating
 * API call finishes writing its local row (e.g. `payment_intent.
 * succeeded` landing before `InvoiceService.createInvoice` commits),
 * the relevant handler marks the event as ORPHANED and returns. A
 * reconciliation sweep can revisit ORPHANED rows later. This is rare
 * in practice because the originating API call commits its local
 * row BEFORE returning the Stripe URL to the client.
 *
 * Phase 1 scope: only `account.updated` is wired. The remaining
 * handlers are stubs that mark the event PROCESSED without any side
 * effects, so webhooks don't pile up as IGNORED while we build out
 * Phases 2–5.
 */
@Injectable()
export class WebhookHandlerService {
  /**
   * Event types we actively handle. Any other type is still stored
   * in webhook_event (status=IGNORED) for audit but we return 200.
   */
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

    // Handled event: run the handler and the audit-row status update
    // in ONE transaction. If the handler throws after partial DB
    // writes (e.g. invoice row updated but payment row create fails),
    // both the partial state AND the status='processed' update roll
    // back, so the event stays eligible for Stripe's next retry.
    //
    // IMPORTANT for Phase 2+: handlers must pass the transaction
    // through to every ORM call via `{ transaction: tx }` — otherwise
    // writes happen on the default connection and the rollback is a
    // no-op. The Phase 1 stub does nothing so this is latent until a
    // real handler lands.
    try {
      await this.sequelize.transaction(async (tx) => {
        await this.dispatchHandler(event, tx);
        auditRow.status = WebhookEventStatus.PROCESSED;
        auditRow.processedAt = new Date();
        await auditRow.save({ transaction: tx });
      });
      return {
        eventId: event.id,
        type: event.type,
        duplicate: false,
        status: WebhookEventStatus.PROCESSED,
      };
    } catch (err) {
      // Orphan: webhook references a Stripe entity we have no local
      // mirror for. Stamp 'orphaned' and return 200 — Stripe should NOT
      // retry-spam us, the reconciliation worker (jobs sprint) sweeps
      // these rows once the originating local row appears.
      if (err instanceof OrphanedWebhookError) {
        this.logger.warn(
          `Webhook orphaned: ${event.type} (${event.id}) — ${err.message}`,
          'WebhookHandlerService',
        );
        auditRow.status = WebhookEventStatus.ORPHANED;
        auditRow.error = err.message;
        await auditRow.save();
        return {
          eventId: event.id,
          type: event.type,
          duplicate: false,
          status: WebhookEventStatus.ORPHANED,
        };
      }

      const message = err instanceof Error ? err.message : String(err);
      // Log id + type + error message only — NEVER log event.data.object.
      this.logger.error(
        `Webhook handler failed for ${event.type} (${event.id}): ${message}`,
        err instanceof Error ? err.stack : undefined,
        'WebhookHandlerService',
      );
      // Write the failure status in a NEW (autocommitted) query so it
      // persists even though the transaction above rolled back.
      auditRow.status = WebhookEventStatus.FAILED;
      auditRow.error = message;
      await auditRow.save();
      // Rethrow so controller returns 500 and Stripe retries.
      throw err;
    }
  }

  /**
   * Route the event to the right handler. In Phase 1 we only wire
   * `account.updated` — the other types are accepted but no-op'd so
   * the audit log still records them. As each phase lands, replace
   * the no-op with the real handler.
   */
  private async dispatchHandler(
    event: Stripe.Event,
    tx: Transaction,
  ): Promise<void> {
    switch (event.type) {
      // PHASE 2 — Connect onboarding
      case 'account.updated':
      case 'capability.updated':
        // capability.updated fires alongside account.updated when a single
        // capability flips state. Both feed the same sync routine — Stripe
        // gives us the full account on the event for `account.updated` and
        // we re-fetch when only the capability is in the payload.
        await this.handleAccountUpdated(event, tx);
        break;

      case 'account.application.deauthorized':
        await this.handleAccountDeauthorized(event, tx);
        break;

      // PHASE 3 — Invoices + payments
      case 'invoice.created':
      case 'invoice.finalized':
      case 'invoice.paid':
      case 'invoice.voided':
        await this.invoiceService.syncFromStripeInvoice(event.data.object, tx);
        break;

      case 'invoice.payment_failed':
        await this.invoiceService.handlePaymentFailed(event.data.object, tx);
        break;

      case 'payment_intent.succeeded':
      case 'payment_intent.payment_failed':
        await this.invoiceService.syncPaymentFromIntent(event.data.object, tx);
        break;

      // PHASE 4 — Subscriptions
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
      case 'customer.subscription.trial_will_end':
        await this.subscriptionService.syncFromWebhook(event.data.object, tx);
        break;

      // PHASE 5 — Refunds + disputes + payouts
      case 'charge.refunded':
        await this.refundService.syncRefundFromWebhook(event.data.object, tx);
        break;

      case 'charge.dispute.created':
      case 'payout.paid':
      case 'payout.failed':
        this.logger.log(
          `Event ${event.type} accepted but handler is minimal (${event.id})`,
          'WebhookHandlerService',
        );
        break;

      default:
        // Unreachable: handledEventTypes set is the source of truth.
        break;
    }
  }

  // =====================================================================
  // PHASE 2 HANDLERS — Connect onboarding
  // =====================================================================

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
      await this.connectService.syncAccountFromWebhook(fullAccount, tx);
      return;
    }

    const account = event.data.object as Stripe.Account;
    await this.connectService.syncAccountFromWebhook(account, tx);
  }

  /**
   * account.application.deauthorized — instructor revoked our OAuth grant.
   * The connected account id is on `event.account` (top-level field on
   * Connect events), not in `event.data.object`.
   */
  private async handleAccountDeauthorized(
    event: Stripe.Event,
    tx: Transaction,
  ): Promise<void> {
    const accountId = event.account;
    if (!accountId) {
      this.logger.warn(
        `account.application.deauthorized missing event.account (${event.id})`,
        'WebhookHandlerService',
      );
      return;
    }
    await this.connectService.handleDeauthorized(accountId, tx);
  }
}
