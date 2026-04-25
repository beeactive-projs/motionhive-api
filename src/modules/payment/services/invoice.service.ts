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
import { StripeCustomer } from '../entities/stripe-customer.entity';
import { Subscription } from '../entities/subscription.entity';
import { User } from '../../user/entities/user.entity';
import { StripeService } from './stripe.service';
import { CustomerService } from './customer.service';
import { EmailService } from '../../../common/services/email.service';
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
export interface InvoiceResponse {
  [key: string]: unknown;
  clientEmail: string | null;
  client: {
    id: string | null;
    email: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
}

@Injectable()
export class InvoiceService {
  constructor(
    @InjectModel(Invoice)
    private readonly invoiceModel: typeof Invoice,
    @InjectModel(Payment)
    private readonly paymentModel: typeof Payment,
    @InjectModel(StripeAccount)
    private readonly stripeAccountModel: typeof StripeAccount,
    @InjectModel(StripeCustomer)
    private readonly stripeCustomerModel: typeof StripeCustomer,
    @InjectModel(Subscription)
    private readonly subscriptionModel: typeof Subscription,
    @InjectModel(User)
    private readonly userModel: typeof User,
    private readonly sequelize: Sequelize,
    private readonly stripeService: StripeService,
    private readonly customerService: CustomerService,
    private readonly emailService: EmailService,
    private readonly notificationService: NotificationService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Build a response object for a single invoice with `clientEmail` and a
   * `client` summary — works for both registered users (via User relation)
   * and guests (via stripe_customer row).
   */
  private async enrich(invoice: Invoice): Promise<InvoiceResponse> {
    return (await this.enrichMany([invoice]))[0];
  }

  /**
   * Batch enrichment — one query for all Users, one for all StripeCustomers.
   */
  private async enrichMany(invoices: Invoice[]): Promise<InvoiceResponse[]> {
    if (invoices.length === 0) return [];

    const userIds = Array.from(
      new Set(invoices.map((i) => i.clientId).filter((x): x is string => !!x)),
    );
    const stripeCustomerIds = Array.from(
      new Set(invoices.map((i) => i.stripeCustomerId).filter((x) => !!x)),
    );

    const [users, stripeCustomers] = await Promise.all([
      userIds.length
        ? this.sequelize.models.User.findAll({
            where: { id: { [Op.in]: userIds } },
          })
        : Promise.resolve([]),
      stripeCustomerIds.length
        ? this.stripeCustomerModel.findAll({
            where: { stripeCustomerId: { [Op.in]: stripeCustomerIds } },
          })
        : Promise.resolve([]),
    ]);

    const userById = new Map<string, User>(
      (users as User[]).map((u) => [u.id, u]),
    );
    const scById = new Map<string, StripeCustomer>(
      stripeCustomers.map((sc) => [sc.stripeCustomerId, sc]),
    );

    return invoices.map((inv) => {
      const json = inv.toJSON();
      const user = inv.clientId ? userById.get(inv.clientId) : undefined;
      const sc = scById.get(inv.stripeCustomerId);

      const email = user?.email ?? sc?.email ?? null;
      const firstName = user?.firstName ?? null;
      const lastName = user?.lastName ?? null;
      const guestName = sc?.name ?? null;

      json['clientEmail'] = email;
      json['client'] = email
        ? {
            id: user?.id ?? null,
            email,
            firstName:
              firstName ?? (guestName ? guestName.split(' ')[0] : null),
            lastName:
              lastName ??
              (guestName && guestName.includes(' ')
                ? guestName.split(' ').slice(1).join(' ')
                : null),
          }
        : null;
      return json as unknown as InvoiceResponse;
    });
  }

  // =====================================================================
  // INSTRUCTOR FLOWS
  // =====================================================================

  async createOneOff(
    instructorId: string,
    dto: CreateInvoiceDto,
  ): Promise<InvoiceResponse> {
    // Bill-to must be EXACTLY one of clientUserId or guestEmail.
    // The DTO's ValidateIf enforces "at least one" but not "not both".
    const hasClient = !!dto.clientUserId;
    const hasGuest = !!dto.guestEmail;
    if (hasClient === hasGuest) {
      throw new BadRequestException(
        'Provide exactly one of clientUserId or guestEmail.',
      );
    }
    if (hasGuest && !dto.guestName) {
      throw new BadRequestException(
        'guestName is required when guestEmail is set.',
      );
    }

    // Stripe rejects past timestamps for `due_date`. Reject here with a
    // friendly 400 so we don't waste a Stripe round-trip + void a local
    // row for a preventable input error.
    if (dto.dueDate) {
      this.assertDueDateNotPast(dto.dueDate);
    }

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

    const instructorUser = await this.userModel.findByPk(instructorId);
    const currency = this.stripeService.resolveCurrency({
      explicit: dto.currency,
      accountCurrency: account.defaultCurrency,
      countryCode: instructorUser?.countryCode,
    });
    const totalCents = dto.lineItems.reduce(
      (sum, line) => sum + line.amountCents * (line.quantity ?? 1),
      0,
    );
    const feeBps = account.platformFeeBps ?? 0;
    const feeParams = this.stripeService.buildFeeParams(totalCents, feeBps);

    // Step 1: resolve customer + insert local row in a short transaction,
    // so Stripe calls below run OUTSIDE any open DB transaction (API
    // latency must not hold a DB connection open) and so we have a
    // stable local id to use as the Stripe idempotency key.
    const { row, stripeCustomerId } = await this.sequelize.transaction(
      async (tx) => {
        const customer = dto.clientUserId
          ? await this.customerService.getOrCreateForUser(dto.clientUserId, tx)
          : await this.customerService.getOrCreateGuest(
              dto.guestEmail as string,
              dto.guestName as string,
              tx,
            );
        const created = await this.invoiceModel.create(
          {
            instructorId,
            clientId: dto.clientUserId ?? null,
            stripeCustomerId: customer.stripeCustomerId,
            // Left NULL until the Stripe API call below returns the real
            // id. The column is UNIQUE and Postgres treats NULLs as
            // distinct, so concurrent drafts with NULL placeholders don't
            // collide on the unique index. Setting this to '' (as we used
            // to) causes the 2nd draft ever created to fail that UNIQUE.
            stripeInvoiceId: null,
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
        return {
          row: created,
          stripeCustomerId: customer.stripeCustomerId,
        };
      },
    );

    // Step 2: Stripe calls — idempotency keys derived from the stable
    // local row id so any retry (ours or SDK network retry) resolves to
    // the same Stripe invoice + line items.
    try {
      const stripeInvoice = await this.stripeService.stripe.invoices.create(
        {
          customer: stripeCustomerId,
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
            beeactive_invoice_id: row.id,
            beeactive_instructor_id: instructorId,
            ...(dto.clientUserId && {
              beeactive_client_id: dto.clientUserId,
            }),
          },
        },
        {
          idempotencyKey: this.stripeService.buildIdempotencyKey(
            'invoice',
            row.id,
            'create',
          ),
        },
      );

      for (let i = 0; i < dto.lineItems.length; i++) {
        const line = dto.lineItems[i];
        await this.stripeService.stripe.invoiceItems.create(
          {
            customer: stripeCustomerId,
            invoice: stripeInvoice.id,
            amount: line.amountCents * (line.quantity ?? 1),
            currency,
            description: line.description,
          },
          {
            idempotencyKey: this.stripeService.buildIdempotencyKey(
              'invoice_item',
              row.id,
              `line_${i}`,
            ),
          },
        );
      }

      row.stripeInvoiceId = stripeInvoice.id!;
      await row.save();
      this.logger.log(
        `Invoice ${row.id} (stripe ${stripeInvoice.id}) created for instructor ${instructorId}`,
        'InvoiceService',
      );

      if (dto.sendImmediately) {
        return this.sendInvoice(instructorId, row.id);
      }
      return this.enrich(row);
    } catch (err) {
      // Stripe failed — mark the local row VOID so dashboards filter it
      // out. We do NOT delete the row: keep an audit trail of failed
      // attempts. The reconciliation sweep can identify it by the empty
      // stripeInvoiceId.
      this.logger.error(
        `Stripe invoice creation failed for local invoice ${row.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
        'InvoiceService',
      );
      row.status = InvoiceStatus.VOID;
      row.voidedAt = new Date();
      await row.save().catch(() => {
        // swallow — the original error is what we re-throw
      });
      throw err;
    }
  }

  /**
   * Update a DRAFT invoice in place.
   *
   * Stripe's data model: invoice metadata (`due_date`, `description`) is
   * mutable on a draft via `invoices.update`; line items are separate
   * `invoiceitem` objects that can only be added/removed individually
   * (no batch replace). For correctness we list every existing item on
   * the draft and delete them, then re-create the full set from the
   * incoming DTO. That keeps the invoice consistent even if a previous
   * edit half-failed and left orphan items behind.
   *
   * Status guard: any state past DRAFT is rejected. Once an invoice is
   * finalized/sent (OPEN/PAID/VOID/UNCOLLECTIBLE) the line items are
   * frozen on Stripe — there is no API to change them. The right move
   * for users is "void + create new", which the UI will surface.
   *
   * Idempotency: the new line items use a deterministic key
   * `invoice_item:<row.id>:edit_<editVersion>_line_<i>`. We bump
   * `editVersion` (derived from the call timestamp) so re-issuing the
   * same edit retries cleanly via Stripe's idempotency layer, but two
   * *different* edits in flight don't collide on the same key.
   */
  async updateDraft(
    instructorId: string,
    invoiceId: string,
    dto: {
      lineItems?: {
        description: string;
        amountCents: number;
        quantity?: number;
      }[];
      dueDate?: string;
      description?: string;
    },
  ): Promise<InvoiceResponse> {
    if (
      !dto.lineItems &&
      dto.dueDate === undefined &&
      dto.description === undefined
    ) {
      throw new BadRequestException(
        'Provide at least one of lineItems, dueDate, or description.',
      );
    }

    if (dto.dueDate) {
      this.assertDueDateNotPast(dto.dueDate);
    }

    const invoice = await this.requireOwnedInvoice(instructorId, invoiceId);
    if (invoice.status !== InvoiceStatus.DRAFT) {
      throw new BadRequestException(
        'Only draft invoices can be edited. Void this invoice and create a new one to make changes.',
      );
    }
    const stripeInvoiceId = this.requireStripeInvoiceId(invoice);

    // Recompute the fee in case line-item totals changed. Read account
    // fresh because admins can adjust fee bps live.
    const account = await this.stripeAccountModel.findOne({
      where: { userId: instructorId },
    });
    if (!account) {
      throw new UnprocessableEntityException(
        'Stripe account is no longer available for this instructor.',
      );
    }
    const feeBps = account.platformFeeBps ?? 0;

    const editVersion = Date.now();

    // 1. If line items changed, swap them on Stripe (delete then recreate).
    if (dto.lineItems) {
      const existing = await this.stripeService.stripe.invoiceItems.list({
        invoice: stripeInvoiceId,
        limit: 100,
      });
      for (const item of existing.data) {
        await this.stripeService.stripe.invoiceItems.del(item.id);
      }

      const currency = invoice.currency.toLowerCase();
      for (let i = 0; i < dto.lineItems.length; i++) {
        const line = dto.lineItems[i];
        await this.stripeService.stripe.invoiceItems.create(
          {
            customer: invoice.stripeCustomerId,
            invoice: stripeInvoiceId,
            amount: line.amountCents * (line.quantity ?? 1),
            currency,
            description: line.description,
          },
          {
            idempotencyKey: this.stripeService.buildIdempotencyKey(
              'invoice_item',
              invoice.id,
              `edit_${editVersion}_line_${i}`,
            ),
          },
        );
      }
    }

    // 2. Update invoice metadata (due_date, description, fee). Recompute
    //    `application_fee_amount` from the *new* total — Stripe rejects
    //    `application_fee_amount` higher than the invoice total.
    const newTotalCents = dto.lineItems
      ? dto.lineItems.reduce(
          (sum, line) => sum + line.amountCents * (line.quantity ?? 1),
          0,
        )
      : invoice.amountDueCents;
    const feeParams = this.stripeService.buildFeeParams(newTotalCents, feeBps);

    const updateParams: Stripe.InvoiceUpdateParams = {
      ...feeParams,
    };
    if (dto.dueDate) {
      // Note: this DTO can't send "" or null — IsOptional + IsDateString
      // means we either get an ISO string or nothing. So this branch
      // only sets a new due date; we never have to "clear" one back to
      // the days_until_due fallback.
      updateParams.due_date = Math.floor(
        new Date(dto.dueDate).getTime() / 1000,
      );
    }
    if (dto.description !== undefined) {
      updateParams.description = dto.description || undefined;
    }

    await this.stripeService.stripe.invoices.update(
      stripeInvoiceId,
      updateParams,
    );

    // 3. Sync local row from the truth on Stripe. We re-fetch instead of
    //    optimistically writing because Stripe is the source of truth
    //    for amount totals (line-item taxes/coupons/etc. could shift
    //    things in the future).
    const fresh =
      await this.stripeService.stripe.invoices.retrieve(stripeInvoiceId);
    invoice.amountDueCents = fresh.amount_due ?? newTotalCents;
    invoice.amountRemainingCents = fresh.amount_remaining ?? newTotalCents;
    invoice.applicationFeeCents = feeParams.application_fee_amount ?? 0;
    if (dto.dueDate !== undefined) {
      invoice.dueDate = dto.dueDate ? new Date(dto.dueDate) : null;
    }
    if (dto.description !== undefined) {
      invoice.description = dto.description || null;
    }
    await invoice.save();

    this.logger.log(
      `Invoice ${invoice.id} (stripe ${stripeInvoiceId}) edited by instructor ${instructorId}`,
      'InvoiceService',
    );

    return this.enrich(invoice);
  }

  async listMine(
    instructorId: string,
    page: number,
    limit: number,
    status?: InvoiceStatus,
  ): Promise<PaginatedResponse<InvoiceResponse>> {
    const where: Record<string, unknown> = { instructorId };
    if (status) where.status = status;
    const { rows, count } = await this.invoiceModel.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset: getOffset(page, limit),
    });
    const enriched = await this.enrichMany(rows);
    return buildPaginatedResponse(enriched, count, page, limit);
  }

  async listForClient(
    clientId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<InvoiceResponse>> {
    const { rows, count } = await this.invoiceModel.findAndCountAll({
      where: {
        clientId,
        status: { [Op.in]: [InvoiceStatus.OPEN, InvoiceStatus.PAID] },
      },
      order: [['createdAt', 'DESC']],
      limit,
      offset: getOffset(page, limit),
    });
    const enriched = await this.enrichMany(rows);
    return buildPaginatedResponse(enriched, count, page, limit);
  }

  /**
   * Count-only lookups for the client's billing tabs. Avoids hydrating
   * the full list just to render a badge next to a tab label.
   */
  async countForClient(
    clientId: string,
  ): Promise<{ total: number; open: number }> {
    const [total, open] = await Promise.all([
      this.invoiceModel.count({
        where: {
          clientId,
          status: { [Op.in]: [InvoiceStatus.OPEN, InvoiceStatus.PAID] },
        },
      }),
      this.invoiceModel.count({
        where: { clientId, status: InvoiceStatus.OPEN },
      }),
    ]);
    return { total, open };
  }

  async getOneForUser(
    invoiceId: string,
    userId: string,
  ): Promise<InvoiceResponse> {
    const invoice = await this.invoiceModel.findByPk(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found.');
    if (invoice.instructorId !== userId && invoice.clientId !== userId) {
      throw new ForbiddenException('You cannot access this invoice.');
    }
    return this.enrich(invoice);
  }

  /**
   * Fetch line items from Stripe on demand. We do not mirror line items
   * locally today — Stripe is source of truth and one extra API call per
   * detail view is acceptable. If we later mirror them in a dedicated
   * table, this method can read locally and fall back to Stripe.
   */
  async getLineItemsForUser(
    invoiceId: string,
    userId: string,
  ): Promise<
    Array<{
      id: string;
      description: string | null;
      quantity: number;
      unitAmountCents: number;
      amountCents: number;
      currency: string;
    }>
  > {
    const invoice = await this.invoiceModel.findByPk(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found.');
    if (invoice.instructorId !== userId && invoice.clientId !== userId) {
      throw new ForbiddenException('You cannot access this invoice.');
    }
    if (!invoice.stripeInvoiceId) return [];

    try {
      const result = await this.stripeService.stripe.invoices.listLineItems(
        invoice.stripeInvoiceId,
        { limit: 100 },
      );
      return result.data.map((li) => {
        const raw = li as unknown as Record<string, unknown>;
        const unitAmount =
          (raw['price'] as { unit_amount?: number } | null)?.unit_amount ??
          Math.round(li.amount / (li.quantity || 1));
        return {
          id: li.id,
          description: li.description ?? null,
          quantity: li.quantity ?? 1,
          unitAmountCents: unitAmount,
          amountCents: li.amount,
          currency: (li.currency ?? invoice.currency).toUpperCase(),
        };
      });
    } catch (err) {
      this.logger.error(
        `Failed to list line items for invoice ${invoiceId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err instanceof Error ? err.stack : undefined,
        'InvoiceService',
      );
      return [];
    }
  }

  /**
   * Finalize a draft invoice → status OPEN.
   *
   * Two delivery paths:
   *   - No `overrideEmail` (or override matches the customer's on-file
   *     email): Stripe sends the email natively. Keeps receipt tracking
   *     consistent in the Stripe dashboard.
   *   - `overrideEmail` present and different: we skip Stripe's native
   *     send and deliver the hosted-invoice link via our own Resend
   *     transport. Stripe's `invoices.sendInvoice` doesn't accept a
   *     per-send recipient — it always targets the customer's saved
   *     email — so overrides are necessarily routed through us.
   *
   * Idempotent: calling on an already-open invoice only re-triggers the
   * email; finalization is skipped.
   */
  async sendInvoice(
    instructorId: string,
    invoiceId: string,
    overrideEmail?: string,
  ): Promise<InvoiceResponse> {
    const invoice = await this.requireOwnedInvoice(instructorId, invoiceId);
    if (
      invoice.status !== InvoiceStatus.DRAFT &&
      invoice.status !== InvoiceStatus.OPEN
    ) {
      throw new BadRequestException(
        `Cannot send an invoice in status ${invoice.status}.`,
      );
    }

    const stripeInvoiceId = this.requireStripeInvoiceId(invoice);

    if (invoice.status === InvoiceStatus.DRAFT) {
      const finalized =
        await this.stripeService.stripe.invoices.finalizeInvoice(
          stripeInvoiceId,
          undefined,
          {
            idempotencyKey: this.stripeService.buildIdempotencyKey(
              'invoice',
              invoice.id,
              'finalize',
            ),
          },
        );
      invoice.status = InvoiceStatus.OPEN;
      invoice.finalizedAt = new Date();
      invoice.hostedInvoiceUrl = finalized.hosted_invoice_url ?? null;
      invoice.invoicePdf = finalized.invoice_pdf ?? null;
      invoice.number = finalized.number ?? null;
    }

    // Resolve the recipient for the override decision.
    const onFileEmail = await this.resolveOnFileEmail(invoice);
    const normalizedOverride = overrideEmail?.trim().toLowerCase() || null;
    const normalizedOnFile = onFileEmail?.trim().toLowerCase() || null;
    const useOverridePath =
      !!normalizedOverride && normalizedOverride !== normalizedOnFile;

    if (useOverridePath) {
      if (!invoice.hostedInvoiceUrl) {
        // Shouldn't happen — finalization always returns a hosted URL —
        // but refuse to send an empty-link email rather than silently
        // shipping a broken one.
        throw new BadRequestException(
          'Invoice is not ready to send (hosted URL missing).',
        );
      }
      const instructor = (await this.sequelize.models.User.findByPk(
        instructorId,
      )) as User | null;
      const instructorName =
        [instructor?.firstName, instructor?.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || 'Your instructor';
      const amountLabel = this.formatAmount(
        invoice.amountDueCents,
        invoice.currency,
      );
      const dueDateLabel = invoice.dueDate
        ? new Date(invoice.dueDate).toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })
        : null;

      await this.emailService.sendInvoiceEmail({
        to: overrideEmail as string,
        instructorName,
        amountLabel,
        dueDateLabel,
        invoiceNumber: invoice.number,
        hostedInvoiceUrl: invoice.hostedInvoiceUrl,
        invoicePdfUrl: invoice.invoicePdf,
        recipientName: null,
      });
      this.logger.log(
        `Invoice ${invoice.id} delivered to override address ${overrideEmail} (on-file: ${onFileEmail ?? 'none'})`,
        'InvoiceService',
      );
    } else {
      await this.stripeService.stripe.invoices.sendInvoice(
        stripeInvoiceId,
        undefined,
        {
          idempotencyKey: this.stripeService.buildIdempotencyKey(
            'invoice',
            invoice.id,
            'send',
          ),
        },
      );
    }
    await invoice.save();
    return this.enrich(invoice);
  }

  /**
   * Look up the customer's email (registered user or stripe_customer
   * guest row). Returns null when neither is available.
   */
  private async resolveOnFileEmail(invoice: Invoice): Promise<string | null> {
    if (invoice.clientId) {
      const user = (await this.sequelize.models.User.findByPk(
        invoice.clientId,
      )) as User | null;
      if (user?.email) return user.email;
    }
    const sc = await this.stripeCustomerModel.findOne({
      where: { stripeCustomerId: invoice.stripeCustomerId },
    });
    return sc?.email ?? null;
  }

  private formatAmount(amountCents: number, currency: string): string {
    const amount = amountCents / 100;
    const code = currency.toUpperCase();
    return `${amount.toFixed(2)} ${code}`;
  }

  async voidInvoice(
    instructorId: string,
    invoiceId: string,
  ): Promise<InvoiceResponse> {
    const invoice = await this.requireOwnedInvoice(instructorId, invoiceId);
    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException(
        'Cannot void a paid invoice. Issue a refund instead.',
      );
    }
    if (invoice.status === InvoiceStatus.VOID) return this.enrich(invoice);

    const stripeInvoiceId = this.requireStripeInvoiceId(invoice);
    await this.stripeService.stripe.invoices.voidInvoice(
      stripeInvoiceId,
      undefined,
      {
        idempotencyKey: this.stripeService.buildIdempotencyKey(
          'invoice',
          invoice.id,
          'void',
        ),
      },
    );
    invoice.status = InvoiceStatus.VOID;
    invoice.voidedAt = new Date();
    await invoice.save();
    return this.enrich(invoice);
  }

  /**
   * Cash / bank transfer mark-paid. Uses Stripe's `paid_out_of_band=true`
   * so the invoice flips to PAID without a real charge or fees.
   */
  async markPaidOutOfBand(
    instructorId: string,
    invoiceId: string,
  ): Promise<InvoiceResponse> {
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

    const stripeInvoiceId = this.requireStripeInvoiceId(invoice);

    // Finalize first if still draft — Stripe requires it.
    if (invoice.status === InvoiceStatus.DRAFT) {
      await this.stripeService.stripe.invoices.finalizeInvoice(
        stripeInvoiceId,
        undefined,
        {
          idempotencyKey: this.stripeService.buildIdempotencyKey(
            'invoice',
            invoice.id,
            'finalize',
          ),
        },
      );
    }
    await this.stripeService.stripe.invoices.pay(
      stripeInvoiceId,
      { paid_out_of_band: true },
      {
        idempotencyKey: this.stripeService.buildIdempotencyKey(
          'invoice',
          invoice.id,
          'pay_oob',
        ),
      },
    );

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
    return this.enrich(invoice);
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
    let local = await this.invoiceModel.findOne({
      where: { stripeInvoiceId: stripeInvoice.id },
      transaction: tx,
    });

    // SUBSCRIPTION-INVOICE INGESTION
    // Stripe creates these for us automatically — one per billing
    // cycle, plus the activation invoice when a subscription is set
    // up. They never go through our `createOneOff` path, so they have
    // no local row by default. Without this lazy-create branch they
    // would be invisible to clients and instructors forever.
    //
    // We identify the originating subscription via:
    //   1. Our own `beeactive_subscription_id` metadata (set on every
    //      sub we create — most reliable).
    //   2. Fallback: `parent.subscription_details.subscription` (Dahlia
    //      API; older API versions surfaced this at `invoice.subscription`
    //      — we check both for forward/back compat).
    if (!local) {
      const localSub = await this.findLocalSubFromInvoice(stripeInvoice, tx);
      if (localSub) {
        local = await this.createInvoiceRowFromSubscription(
          stripeInvoice,
          localSub,
          tx,
        );
      } else {
        // Truly orphan — log once and ignore.
        return null;
      }
    }

    const wasPaid = local.status === InvoiceStatus.PAID;

    local.status = this.mapStripeInvoiceStatus(
      stripeInvoice.status,
      local.status,
    );
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
    local.status = this.mapStripeInvoiceStatus(
      stripeInvoice.status,
      local.status,
    );
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

  /**
   * Map a Stripe invoice status string onto our local enum. Stripe's
   * documented values (`draft|open|paid|void|uncollectible`) match our
   * enum 1:1, but we guard against nulls and unknown future values
   * rather than blind-casting into a Sequelize `isIn`-validated column.
   */
  private mapStripeInvoiceStatus(
    stripeStatus: string | null | undefined,
    current: InvoiceStatus,
  ): InvoiceStatus {
    if (!stripeStatus) return current;
    const valid = Object.values(InvoiceStatus) as string[];
    if (valid.includes(stripeStatus)) {
      return stripeStatus as InvoiceStatus;
    }
    this.logger.warn(
      `Unknown Stripe invoice status "${stripeStatus}" — keeping local status "${current}"`,
      'InvoiceService',
    );
    return current;
  }

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
   * Locate our local Subscription row from a Stripe Invoice payload.
   * Tries metadata first (set by us on every subscription we create),
   * then the Dahlia and pre-Dahlia subscription pointer locations.
   * Returns null if the invoice doesn't belong to a subscription we
   * track (e.g. created directly in the Stripe Dashboard).
   */
  private async findLocalSubFromInvoice(
    stripeInvoice: Stripe.Invoice,
    tx: Transaction,
  ): Promise<Subscription | null> {
    // Cast to a permissive shape — Stripe SDK types lag the live API.
    const raw = stripeInvoice as unknown as {
      subscription?: string | null;
      parent?: {
        subscription_details?: { subscription?: string | null } | null;
      } | null;
      metadata?: Record<string, string> | null;
      lines?: { data?: { metadata?: Record<string, string> | null }[] };
    };

    const fromInvoiceMeta = raw.metadata?.beeactive_subscription_id;
    const fromLineMeta =
      raw.lines?.data?.[0]?.metadata?.beeactive_subscription_id;
    const localSubId = fromInvoiceMeta ?? fromLineMeta;
    if (localSubId) {
      const sub = await this.subscriptionModel.findByPk(localSubId, {
        transaction: tx,
      });
      if (sub) return sub;
    }

    const stripeSubId =
      raw.parent?.subscription_details?.subscription ??
      raw.subscription ??
      null;
    if (stripeSubId) {
      return this.subscriptionModel.findOne({
        where: { stripeSubscriptionId: stripeSubId },
        transaction: tx,
      });
    }
    return null;
  }

  /**
   * Materialize a local invoice row for a subscription-generated
   * Stripe invoice we hadn't seen before. The caller (sync) then
   * applies the rest of the field updates as if the row had always
   * existed.
   */
  private async createInvoiceRowFromSubscription(
    stripeInvoice: Stripe.Invoice,
    sub: Subscription,
    tx: Transaction,
  ): Promise<Invoice> {
    const status = this.mapStripeInvoiceStatus(
      stripeInvoice.status,
      InvoiceStatus.DRAFT,
    );
    return this.invoiceModel.create(
      {
        instructorId: sub.instructorId,
        clientId: sub.clientId,
        stripeCustomerId: sub.stripeCustomerId,
        stripeInvoiceId: stripeInvoice.id ?? null,
        subscriptionId: sub.id,
        number: stripeInvoice.number ?? null,
        status,
        amountDueCents: stripeInvoice.amount_due ?? sub.amountCents,
        amountPaidCents: stripeInvoice.amount_paid ?? 0,
        amountRemainingCents:
          stripeInvoice.amount_remaining ?? stripeInvoice.amount_due ?? 0,
        currency: (stripeInvoice.currency ?? sub.currency).toUpperCase(),
        applicationFeeCents:
          (stripeInvoice as unknown as { application_fee_amount?: number })
            .application_fee_amount ?? 0,
        dueDate: stripeInvoice.due_date
          ? new Date(stripeInvoice.due_date * 1000)
          : null,
        finalizedAt: ['open', 'paid', 'uncollectible'].includes(
          stripeInvoice.status ?? '',
        )
          ? new Date()
          : null,
        paidAt: stripeInvoice.status === 'paid' ? new Date() : null,
        voidedAt: null,
        hostedInvoiceUrl: stripeInvoice.hosted_invoice_url ?? null,
        invoicePdf: stripeInvoice.invoice_pdf ?? null,
        paidOutOfBand: false,
        description: null,
        metadata: null,
        // Subscription-generated invoices don't go through our EU
        // waiver UI (the consent was given when the subscription was
        // accepted), so the flag stays off.
        requiresImmediateAccessWaiver: false,
        waiverAcceptedAt: null,
      },
      { transaction: tx },
    );
  }

  /**
   * Validate that a due-date string isn't in the past. Throws 400 on
   * unparseable input and on past dates.
   *
   * Why we use UTC midnight on BOTH sides:
   *   ISO date-only strings (e.g. "2026-04-25" — what the DTO emits)
   *   parse as UTC midnight via `new Date(...)`.
   *   `new Date(); setHours(0,0,0,0)` produces *local* midnight, which
   *   differs from UTC midnight by the server's timezone offset.
   *   For a server in UTC- (Americas), local midnight is AHEAD of UTC
   *   midnight, so today's-date inputs would be rejected as "past".
   *   Comparing UTC-to-UTC eliminates that drift entirely.
   */
  private assertDueDateNotPast(dueDateInput: string): void {
    const due = new Date(dueDateInput);
    if (Number.isNaN(due.getTime())) {
      throw new BadRequestException('Invalid due date.');
    }
    const now = new Date();
    const todayUtcMs = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );
    if (due.getTime() < todayUtcMs) {
      throw new BadRequestException('Due date cannot be in the past.');
    }
  }

  /**
   * Narrow the nullable `stripeInvoiceId` column to a string for calls
   * that hand it to Stripe. A null id means the local row was never
   * successfully persisted to Stripe (`createOneOff` failed before the
   * Stripe response and marked the row VOID); all mutation paths gate
   * on `status` first, so in practice this should never fire, but we
   * refuse rather than pass `undefined` to the Stripe SDK.
   */
  private requireStripeInvoiceId(invoice: Invoice): string {
    if (!invoice.stripeInvoiceId) {
      throw new BadRequestException(
        'Invoice has no Stripe record — it was never successfully created on Stripe.',
      );
    }
    return invoice.stripeInvoiceId;
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
