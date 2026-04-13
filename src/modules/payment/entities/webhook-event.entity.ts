import { Table, Column, Model, DataType } from 'sequelize-typescript';

/**
 * Webhook processing status values.
 *
 * - PROCESSING — row inserted, handler in-flight
 * - PROCESSED  — handler completed successfully
 * - FAILED     — handler threw; error column has the message
 * - ORPHANED   — event arrived but no corresponding local row exists
 *                (e.g. payment_intent.succeeded without a `payment`
 *                row to update). A reconciliation job should pick
 *                these up later.
 * - IGNORED    — event type we explicitly do not handle
 */
export enum WebhookEventStatus {
  PROCESSING = 'processing',
  PROCESSED = 'processed',
  FAILED = 'failed',
  ORPHANED = 'orphaned',
  IGNORED = 'ignored',
}

/**
 * WebhookEvent Entity
 *
 * Idempotency log for Stripe webhook deliveries. Stripe retries
 * aggressively (up to 3 days, exponential backoff); without this
 * table we would double-process events (send notifications twice,
 * create duplicate payment rows, etc.).
 *
 * Processing flow (see webhook-handler.service.ts):
 *   1. Verify signature against the raw body
 *   2. INSERT INTO webhook_event (stripe_event_id, status='processing', ...)
 *      — UNIQUE index on stripe_event_id makes this the idempotency
 *        checkpoint. If the insert conflicts, return 200 immediately.
 *   3. Run the type-specific handler in a DB transaction
 *   4. On success: UPDATE status='processed', processed_at=NOW()
 *   5. On handler exception: UPDATE status='failed', error=<msg>
 *      — then respond 500 so Stripe retries.
 *
 * IMPORTANT: the `payload` column is stored for debugging and support
 * use only. It contains PII (customer email, name, card last4, billing
 * address). It MUST NOT be logged to Winston/stdout/APM — see
 * WebhookHandlerService for the logging policy.
 */
@Table({
  tableName: 'webhook_event',
  timestamps: false,
  underscored: true,
})
export class WebhookEvent extends Model {
  @Column({
    type: DataType.CHAR(36),
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  /**
   * Stripe event id, always prefixed `evt_`. Unique — this is the
   * deduplication key.
   */
  @Column({
    type: DataType.STRING(255),
    allowNull: false,
  })
  declare stripeEventId: string;

  /**
   * Stripe event type, e.g. `invoice.paid`, `account.updated`.
   */
  @Column({
    type: DataType.STRING(100),
    allowNull: false,
  })
  declare type: string;

  /**
   * Stripe API version that generated the event. Helps diagnose
   * schema drift when Stripe rolls a new API version.
   */
  @Column({
    type: DataType.STRING(20),
    allowNull: true,
  })
  declare apiVersion: string | null;

  /**
   * Full event payload (event.data.object). Contains PII — never log.
   */
  @Column({
    type: DataType.JSONB,
    allowNull: false,
  })
  declare payload: Record<string, unknown>;

  // Stored as VARCHAR in Postgres (app-level enum validation) to
  // mirror the house style from migration 019 — see also product,
  // subscription, invoice, payment entities.
  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    defaultValue: WebhookEventStatus.PROCESSING,
    validate: { isIn: [Object.values(WebhookEventStatus)] },
  })
  declare status: WebhookEventStatus;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare error: string | null;

  // Not using @CreatedAt — timestamps: false disables that decorator.
  // defaultValue ensures the DB column is populated on INSERT without
  // the caller needing to pass it explicitly.
  @Column({
    type: DataType.DATE,
    allowNull: false,
    field: 'received_at',
    defaultValue: DataType.NOW,
  })
  declare receivedAt: Date;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare processedAt: Date | null;
}
