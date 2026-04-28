/**
 * Webhook handler errors that the dispatcher recognizes specially.
 *
 * These are NOT user-facing exceptions — they propagate from a sync
 * routine up to `WebhookHandlerService.handleIncomingEvent`, which
 * catches them and updates the audit-log row accordingly.
 */

/**
 * Thrown when a Stripe webhook references a Stripe entity (invoice,
 * charge, subscription) we have no local mirror for — typically because
 * the originating API call has not committed yet OR because the activity
 * happened directly in the Stripe Dashboard outside the platform.
 *
 * The dispatcher catches this, marks the `webhook_event` row with
 * `status='orphaned'`, and returns 200 to Stripe so it does not retry-
 * spam us. A reconciliation worker (jobs sprint) sweeps orphaned rows
 * later and either resolves them once the local row appears or alerts
 * if they age out.
 *
 * Carry the Stripe object id in the message so it appears in the audit
 * log error column for debugging.
 */
export class OrphanedWebhookError extends Error {
  constructor(
    public readonly stripeObjectType:
      | 'invoice'
      | 'charge'
      | 'payment_intent'
      | 'subscription',
    public readonly stripeObjectId: string,
  ) {
    super(
      `No local row for ${stripeObjectType} ${stripeObjectId} — ` +
        `originating call may not have committed yet, or activity ` +
        `occurred directly in the Stripe Dashboard.`,
    );
    this.name = 'OrphanedWebhookError';
  }
}
