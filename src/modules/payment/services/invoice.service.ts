import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op, Transaction } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import type { Stripe } from 'stripe-types';

import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { StripeAccount } from '../entities/stripe-account.entity';
import { StripeService } from './stripe.service';
import { CustomerService } from './customer.service';
import {
  NotificationService,
  NotificationType,
} from '../../notification/notification.service';
import {
  buildPaginatedResponse,
  getOffset,
  PaginatedResponse,
} from '../../../common/dto/pagination.dto';
import { CreateInvoiceDto } from '../dto/create-invoice.dto';

/**
 * InvoiceService
 *
 * Owns the lifecycle of every Stripe Invoice mirror row. Two creation
 * paths:
 *   1. createOneOff           — instructor builds an ad-hoc invoice
 *   2. ingestFromWebhook      — Stripe pushed an invoice (e.g. subscription
 *                               billing cycle invoice — Phase 4)
 *
 * Stripe rules enforced here:
 *   - Cannot create an invoice if instructor.charges_enabled = false → 422
 *   - Cannot void a PAID invoice → 400 (issue refund instead)
 *   - Cannot mark-paid an already-paid invoice → 409
 *   - applicationFeeAmount=0 is OMITTED from the API call (StripeService.buildFeeParams)
 */
@Injectable()
export class InvoiceService {
  constructor(
    @InjectModel(Invoice)
    private readonly invoiceModel: typeof Invoice,
    @InjectModel(Payment)
    private readonly paymentModel: typeof Payment,
    @InjectModel(StripeAccount)
    private readonly stripeAccountModel: typeof StripeAccount,
    private readonly sequelize: Sequelize,
    private readonly stripeService: StripeService,
    private readonly customerService: CustomerService,
    private readonly notificationService: NotificationService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // =====================================================================
  // INSTRUCTOR FLOWS
  // =====================================================================

  async createOneOff(
    instructorId: string,
    dto: CreateInvoiceDto,
  ): Promise<Invoice> {
    const account = await this.stripeAccountModel.findOne({
      where: { userId: instructorId },
    });
    if (!account) {
      throw new UnprocessableEntityException(
        'Complete Stripe onboarding before issuing invoices.',
      );
    }
    if (!account.chargesEnabled) {
      throw new UnprocessableEntityException(
        'Stripe charges are not enabled on your account yet.',
      );
    }

    const tx = await this.sequelize.transaction();
    try {
      // Resolve customer (registered user OR guest by email).
      const customer = dto.clientUserId
        ? await this.customerService.getOrCreateForUser(dto.clientUserId, tx)
        : await this.customerService.getOrCreateGuest(
            dto.guestEmail!,
            dto.guestName!,
            tx,
          );

      const currency = (dto.currency ?? 'RON').toLowerCase();
      const totalCents = dto.lineItems.reduce(
        (sum, line) => sum + line.amountCents * (line.quantity ?? 1),
        0,
      );

      // Stripe wants ON_BEHALF_OF + transfer_data to route money to the
      // connected account. application_fee_amount is built via the helper
      // so a 0 fee is OMITTED entirely (Stripe rejects explicit 0).
      const feeBps = account.platformFeeBps ?? 0;
      const feeParams = this.stripeService.buildFeeParams(totalCents, feeBps);

      // 1. Create the Stripe Invoice draft.
      const stripeInvoice = await this.stripeService.stripe.invoices.create(
        {
          customer: customer.stripeCustomerId,
          collection_method: 'send_invoice',
          days_until_due: dto.dueDate ? undefined : 7,
          due_date: dto.dueDate
            ? Math.floor(new Date(dto.dueDate).getTime() / 1000)
            : undefined,
          description: dto.description ?? undefined,
          on_behalf_of: account.stripeAccountId,
          transfer_data: { destination: account.stripeAccountId },
          ...feeParams,
          metadata: {
            beeactive_instructor_id: instructorId,
            ...(dto.clientUserId && {
              beeactive_client_id: dto.clientUserId,
            }),
          },
        },
        {
          idempotencyKey: this.stripeService.buildIdempotencyKey(
            'invoice',
            `${instructorId}:${Date.now()}`,
            'create',
          ),
        },
      );

      // 2. Add line items.
      for (const line of dto.lineItems) {
        await this.stripeService.stripe.invoiceItems.create({
          customer: customer.stripeCustomerId,
          invoice: stripeInvoice.id,
          amount: line.amountCents * (line.quantity ?? 1),
          currency,
          description: line.description,
        });
      }

      // 3. Insert local mirror row BEFORE returning — webhooks may arrive
      //    immediately after the create call below.
      const row = await this.invoiceModel.create(
        {
          instructorId,
          clientId: dto.clientUserId ?? null,
          stripeCustomerId: customer.stripeCustomerId,
          stripeInvoiceId: stripeInvoice.id,
          subscriptionId: null,
          number: null,
          status: InvoiceStatus.DRAFT,
          amountDueCents: totalCents,
          amountPaidCents: 0,
          amountRemainingCents: totalCents,
          currency: currency.toUpperCase(),
          applicationFeeCents: feeParams.application_fee_amount ?? 0,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
          finalizedAt: null,
          paidAt: null,
          voidedAt: null,
          hostedInvoiceUrl: null,
          invoicePdf: null,
          paidOutOfBand: false,
          description: dto.description ?? null,
          metadata: null,
          requiresImmediateAccessWaiver:
            dto.requiresImmediateAccessWaiver ?? false,
          waiverAcceptedAt: null,
        },
        { transaction: tx },
      );

      await tx.commit();
      this.logger.log(
        `Invoice ${row.id} (stripe ${stripeInvoice.id}) created for instructor ${instructorId}`,
        'InvoiceService',
      );

      if (dto.sendImmediately) {
        return this.sendInvoice(instructorId, row.id);
      }
      return row;
    } catch (err) {
      try {
        await tx.rollback();
      } catch {
        // ignore
      }
      throw err;
    }
  }

  async listMine(
    instructorId: string,
    page: number,
    limit: number,
    status?: InvoiceStatus,
  ): Promise<PaginatedResponse<Invoice>> {
    const where: Record<string, unknown> = { instructorId };
    if (status) where.status = status;
    const { rows, count } = await this.invoiceModel.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset: getOffset(page, limit),
    });
    return buildPaginatedResponse(rows, count, page, limit);
  }

  async listForClient(
    clientId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<Invoice>> {
    const { rows, count } = await this.invoiceModel.findAndCountAll({
      where: {
        clientId,
        status: { [Op.in]: [InvoiceStatus.OPEN, InvoiceStatus.PAID] },
      },
      order: [['createdAt', 'DESC']],
      limit,
      offset: getOffset(page, limit),
    });
    return buildPaginatedResponse(rows, count, page, limit);
  }

  async getOneForUser(invoiceId: string, userId: string): Promise<Invoice> {
    const invoice = await this.invoiceModel.findByPk(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found.');
    if (invoice.instructorId !== userId && invoice.clientId !== userId) {
      throw new ForbiddenException('You cannot access this invoice.');
    }
    return invoice;
  }

  /**
   * Finalize a draft invoice → status OPEN, Stripe emails the client.
   * Idempotent: calling on an already-open invoice is a no-op.
   */
  async sendInvoice(instructorId: string, invoiceId: string): Promise<Invoice> {
    const invoice = await this.requireOwnedInvoice(instructorId, invoiceId);
    if (
      invoice.status !== InvoiceStatus.DRAFT &&
      invoice.status !== InvoiceStatus.OPEN
    ) {
      throw new BadRequestException(
        `Cannot send an invoice in status ${invoice.status}.`,
      );
    }

    if (invoice.status === InvoiceStatus.DRAFT) {
      const finalized =
        await this.stripeService.stripe.invoices.finalizeInvoice(
          invoice.stripeInvoiceId,
        );
      invoice.status = InvoiceStatus.OPEN;
      invoice.finalizedAt = new Date();
      invoice.hostedInvoiceUrl = finalized.hosted_invoice_url ?? null;
      invoice.invoicePdf = finalized.invoice_pdf ?? null;
      invoice.number = finalized.number ?? null;
    }
    await this.stripeService.stripe.invoices.sendInvoice(
      invoice.stripeInvoiceId,
    );
    await invoice.save();
    return invoice;
  }

  async voidInvoice(instructorId: string, invoiceId: string): Promise<Invoice> {
    const invoice = await this.requireOwnedInvoice(instructorId, invoiceId);
    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException(
        'Cannot void a paid invoice. Issue a refund instead.',
      );
    }
    if (invoice.status === InvoiceStatus.VOID) return invoice;

    await this.stripeService.stripe.invoices.voidInvoice(
      invoice.stripeInvoiceId,
    );
    invoice.status = InvoiceStatus.VOID;
    invoice.voidedAt = new Date();
    await invoice.save();
    return invoice;
  }

  /**
   * Cash / bank transfer mark-paid. Uses Stripe's `paid_out_of_band=true`
   * so the invoice flips to PAID without a real charge or fees.
   */
  async markPaidOutOfBand(
    instructorId: string,
    invoiceId: string,
  ): Promise<Invoice> {
    const invoice = await this.requireOwnedInvoice(instructorId, invoiceId);
    if (invoice.status === InvoiceStatus.PAID) {
      throw new ConflictException('Invoice already marked as paid.');
    }
    if (
      invoice.status !== InvoiceStatus.OPEN &&
      invoice.status !== InvoiceStatus.DRAFT
    ) {
      throw new BadRequestException(
        `Cannot mark-paid an invoice in status ${invoice.status}.`,
      );
    }

    // Finalize first if still draft — Stripe requires it.
    if (invoice.status === InvoiceStatus.DRAFT) {
      await this.stripeService.stripe.invoices.finalizeInvoice(
        invoice.stripeInvoiceId,
      );
    }
    await this.stripeService.stripe.invoices.pay(invoice.stripeInvoiceId, {
      paid_out_of_band: true,
    });

    invoice.status = InvoiceStatus.PAID;
    invoice.paidOutOfBand = true;
    invoice.paidAt = new Date();
    invoice.amountPaidCents = invoice.amountDueCents;
    invoice.amountRemainingCents = 0;
    await invoice.save();

    await this.notificationService.notify({
      userId: instructorId,
      type: NotificationType.INVOICE_PAID,
      title: 'Invoice marked paid',
      body: `Invoice ${invoice.number ?? invoice.id} marked as paid out of band.`,
      data: { screen: 'instructor-invoices', entityId: invoice.id },
    });
    return invoice;
  }

  // =====================================================================
  // WEBHOOK SYNC
  // =====================================================================

  /**
   * Upsert from a Stripe Invoice webhook payload. Called inside the
   * webhook handler's transaction — DO NOT open a new transaction here.
   *
   * Returns null when the local row is missing (race) so the caller can
   * decide whether to log + ignore (Phase 1 stub for sub-generated
   * invoices that don't exist locally yet) or treat as orphaned.
   */
  async syncFromStripeInvoice(
    stripeInvoice: Stripe.Invoice,
    tx: Transaction,
  ): Promise<Invoice | null> {
    const local = await this.invoiceModel.findOne({
      where: { stripeInvoiceId: stripeInvoice.id },
      transaction: tx,
    });
    if (!local) return null;

    const wasPaid = local.status === InvoiceStatus.PAID;

    local.status = (stripeInvoice.status as InvoiceStatus) ?? local.status;
    local.amountDueCents = stripeInvoice.amount_due ?? local.amountDueCents;
    local.amountPaidCents = stripeInvoice.amount_paid ?? local.amountPaidCents;
    local.amountRemainingCents =
      stripeInvoice.amount_remaining ?? local.amountRemainingCents;
    local.number = stripeInvoice.number ?? local.number;
    local.hostedInvoiceUrl =
      stripeInvoice.hosted_invoice_url ?? local.hostedInvoiceUrl;
    local.invoicePdf = stripeInvoice.invoice_pdf ?? local.invoicePdf;

    if (stripeInvoice.status === 'paid' && !local.paidAt) {
      local.paidAt = new Date();
    }
    if (stripeInvoice.status === 'void' && !local.voidedAt) {
      local.voidedAt = new Date();
    }
    await local.save({ transaction: tx });

    // Fire notification only on the transition INTO paid — never on subsequent re-deliveries.
    if (!wasPaid && local.status === InvoiceStatus.PAID) {
      await this.notificationService.notify({
        userId: local.instructorId,
        type: NotificationType.INVOICE_PAID,
        title: 'Invoice paid',
        body: `Invoice ${local.number ?? local.id} was paid by your client.`,
        data: { screen: 'instructor-invoices', entityId: local.id },
      });
      if (local.clientId) {
        await this.notificationService.notify({
          userId: local.clientId,
          type: NotificationType.INVOICE_PAID,
          title: 'Payment received',
          body: 'Thanks — your payment has been processed.',
          data: { screen: 'client-invoices', entityId: local.id },
        });
      }
    }
    return local;
  }

  /**
   * Handle invoice.payment_failed — flip to past_due-equivalent and notify
   * the client. Stripe Smart Retries owns the actual retry schedule.
   */
  async handlePaymentFailed(
    stripeInvoice: Stripe.Invoice,
    tx: Transaction,
  ): Promise<void> {
    const local = await this.invoiceModel.findOne({
      where: { stripeInvoiceId: stripeInvoice.id },
      transaction: tx,
    });
    if (!local) return;

    // Sync fields from the failed invoice payload.
    local.status = (stripeInvoice.status as InvoiceStatus) ?? local.status;
    local.amountDueCents = stripeInvoice.amount_due ?? local.amountDueCents;
    local.amountPaidCents = stripeInvoice.amount_paid ?? local.amountPaidCents;
    local.amountRemainingCents =
      stripeInvoice.amount_remaining ?? local.amountRemainingCents;
    await local.save({ transaction: tx });
    if (local.clientId) {
      await this.notificationService.notify({
        userId: local.clientId,
        type: NotificationType.PAYMENT_FAILED,
        title: 'Payment failed',
        body: 'Your invoice payment failed. Please update your card and retry.',
        data: { screen: 'client-invoices', entityId: local.id },
      });
    }
  }

  // =====================================================================
  // HELPERS
  // =====================================================================

  private async requireOwnedInvoice(
    instructorId: string,
    invoiceId: string,
  ): Promise<Invoice> {
    const invoice = await this.invoiceModel.findByPk(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found.');
    if (invoice.instructorId !== instructorId) {
      throw new ForbiddenException('You do not own this invoice.');
    }
    return invoice;
  }

  /**
   * Used by webhook handlers to look up an invoice by Stripe id.
   */
  findByStripeId(
    stripeInvoiceId: string,
    tx?: Transaction,
  ): Promise<Invoice | null> {
    return this.invoiceModel.findOne({
      where: { stripeInvoiceId },
      transaction: tx,
    });
  }

  /**
   * Find local payment row by Stripe PaymentIntent id (for race-safe webhook
   * handling).
   */
  findPaymentByIntentId(
    stripePaymentIntentId: string,
    tx?: Transaction,
  ): Promise<Payment | null> {
    return this.paymentModel.findOne({
      where: { stripePaymentIntentId },
      transaction: tx,
    });
  }

  /**
   * Upsert from payment_intent.succeeded — creates a Payment row if missing
   * (or updates an existing one to SUCCEEDED).
   */
  async syncPaymentFromIntent(
    intent: Stripe.PaymentIntent,
    tx: Transaction,
  ): Promise<void> {
    // PaymentIntent.invoice is an expandable field — may be string,
    // object, or absent depending on Stripe API version. Access via
    // bracket notation to avoid TS2339 on narrower type definitions.
    const raw = (intent as unknown as Record<string, unknown>)['invoice'];
    const invoiceId =
      typeof raw === 'string'
        ? raw
        : typeof raw === 'object' && raw !== null
          ? ((raw as { id?: string }).id ?? null)
          : null;
    const localInvoice = invoiceId
      ? await this.invoiceModel.findOne({
          where: { stripeInvoiceId: invoiceId },
          transaction: tx,
        })
      : null;

    const existing = await this.paymentModel.findOne({
      where: { stripePaymentIntentId: intent.id },
      transaction: tx,
    });

    if (existing) {
      existing.status =
        intent.status === 'succeeded'
          ? PaymentStatus.SUCCEEDED
          : PaymentStatus.FAILED;
      if (intent.status === 'succeeded') existing.paidAt = new Date();
      await existing.save({ transaction: tx });
      return;
    }

    if (!localInvoice) {
      // Race: invoice row not in DB yet. Log and return — reconciliation
      // sweep (jobs module) will revisit. See project_jobs_module_pending.
      this.logger.warn(
        `payment_intent ${intent.id} arrived before invoice row exists`,
        'InvoiceService',
      );
      return;
    }

    await this.paymentModel.create(
      {
        invoiceId: localInvoice.id,
        instructorId: localInvoice.instructorId,
        clientId: localInvoice.clientId,
        stripePaymentIntentId: intent.id,
        stripeChargeId:
          typeof intent.latest_charge === 'string'
            ? intent.latest_charge
            : (intent.latest_charge?.id ?? null),
        amountCents: intent.amount_received,
        amountRefundedCents: 0,
        currency: intent.currency.toUpperCase(),
        applicationFeeCents: intent.application_fee_amount ?? 0,
        status:
          intent.status === 'succeeded'
            ? PaymentStatus.SUCCEEDED
            : PaymentStatus.FAILED,
        paymentMethodType:
          (intent.payment_method_types && intent.payment_method_types[0]) ??
          null,
        failureCode: intent.last_payment_error?.code ?? null,
        failureMessage: intent.last_payment_error?.message ?? null,
        paidAt: intent.status === 'succeeded' ? new Date() : null,
        refundedAt: null,
      },
      { transaction: tx },
    );
  }
}
