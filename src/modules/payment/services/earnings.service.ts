import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { StripeAccount } from '../entities/stripe-account.entity';
import { User } from '../../user/entities/user.entity';
import { StripeService } from './stripe.service';
import {
  buildPaginatedResponse,
  getOffset,
  PaginatedResponse,
} from '../../../common/dto/pagination.dto';

export interface TopClientSummary {
  clientId: string;
  firstName: string | null;
  lastName: string | null;
  email: string;
  totalPaidCents: number;
}

export interface EarningsSummary {
  currency: string;
  availableBalanceCents: number;
  pendingBalanceCents: number;
  nextPayoutDate: string | null;
  monthToDateRevenueCents: number;
  outstandingInvoicesCents: number;
  openInvoiceCount: number;
  overdueInvoiceCount: number;
  topClients: TopClientSummary[];
}

@Injectable()
export class EarningsService {
  constructor(
    @InjectModel(Invoice)
    private readonly invoiceModel: typeof Invoice,
    @InjectModel(Payment)
    private readonly paymentModel: typeof Payment,
    @InjectModel(StripeAccount)
    private readonly stripeAccountModel: typeof StripeAccount,
    private readonly sequelize: Sequelize,
    private readonly stripeService: StripeService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async getSummary(instructorId: string): Promise<EarningsSummary> {
    const account = await this.stripeAccountModel.findOne({
      where: { userId: instructorId },
      attributes: ['stripeAccountId', 'defaultCurrency'],
    });
    const currency = (account?.defaultCurrency ?? 'ron').toUpperCase();

    // Month-to-date revenue from our DB (source of truth for billing history).
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const [mtdResult] = (await this.paymentModel.findAll({
      attributes: [
        [
          this.sequelize.fn(
            'COALESCE',
            this.sequelize.fn('SUM', this.sequelize.col('amount_cents')),
            0,
          ),
          'total',
        ],
      ],
      where: {
        instructorId,
        status: PaymentStatus.SUCCEEDED,
        paidAt: { [Op.gte]: monthStart },
      },
      raw: true,
    })) as unknown as { total: number }[];
    const monthToDateRevenueCents = Number(mtdResult?.total ?? 0);

    // Outstanding from open invoices — total remaining + counts.
    const outstandingInvoices = await this.invoiceModel.findAll({
      attributes: ['amountRemainingCents', 'dueDate'],
      where: { instructorId, status: InvoiceStatus.OPEN },
      raw: true,
    });
    const outstandingInvoicesCents = outstandingInvoices.reduce(
      (sum: number, r: { amountRemainingCents: number }) =>
        sum + (r.amountRemainingCents ?? 0),
      0,
    );
    const openInvoiceCount = outstandingInvoices.length;
    const overdueInvoiceCount = outstandingInvoices.filter(
      (r: { dueDate: Date | string | null }) =>
        r.dueDate != null && new Date(r.dueDate).getTime() < now.getTime(),
    ).length;

    // Top clients by total paid (lifetime). Grouped at SQL level; names
    // joined in a second pass so we can fall back to StripeCustomer for
    // guest payers (clientId IS NULL).
    const topRaw = (await this.paymentModel.findAll({
      attributes: [
        'clientId',
        [
          this.sequelize.fn(
            'COALESCE',
            this.sequelize.fn('SUM', this.sequelize.col('amount_cents')),
            0,
          ),
          'total',
        ],
      ],
      where: { instructorId, status: PaymentStatus.SUCCEEDED },
      group: ['client_id'],
      order: [[this.sequelize.literal('total'), 'DESC']],
      limit: 5,
      raw: true,
    })) as unknown as Array<{ clientId: string | null; total: number }>;

    const clientIds = topRaw
      .map((r) => r.clientId)
      .filter((x): x is string => !!x);
    const users = clientIds.length
      ? ((await this.sequelize.models.User.findAll({
          where: { id: { [Op.in]: clientIds } },
          attributes: ['id', 'email', 'firstName', 'lastName'],
        })) as unknown as User[])
      : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const topClients: TopClientSummary[] = topRaw
      .filter((r) => !!r.clientId)
      .map((r) => {
        const u = userMap.get(r.clientId!);
        return {
          clientId: r.clientId!,
          firstName: u?.firstName ?? null,
          lastName: u?.lastName ?? null,
          email: u?.email ?? '',
          totalPaidCents: Number(r.total ?? 0),
        };
      });

    // Balances + next payout — pulled from Stripe for the connected
    // account. If onboarding isn't done, default to zeros so the UI can
    // still render.
    let availableBalanceCents = 0;
    let pendingBalanceCents = 0;
    let nextPayoutDate: string | null = null;

    if (account?.stripeAccountId) {
      try {
        const balance = await this.stripeService.stripe.balance.retrieve(
          {},
          { stripeAccount: account.stripeAccountId },
        );
        const lowerCurrency = currency.toLowerCase();
        availableBalanceCents = balance.available
          .filter((b) => b.currency === lowerCurrency)
          .reduce((s, b) => s + b.amount, 0);
        pendingBalanceCents = balance.pending
          .filter((b) => b.currency === lowerCurrency)
          .reduce((s, b) => s + b.amount, 0);

        const payouts = await this.stripeService.stripe.payouts.list(
          { limit: 1, status: 'pending' },
          { stripeAccount: account.stripeAccountId },
        );
        const next = payouts.data[0];
        if (next?.arrival_date) {
          nextPayoutDate = new Date(next.arrival_date * 1000).toISOString();
        }
      } catch (err) {
        this.logger.warn?.(
          `Failed to load Stripe balance for instructor ${instructorId}: ${
            (err as Error).message
          }`,
          'EarningsService',
        );
      }
    }

    return {
      currency,
      availableBalanceCents,
      pendingBalanceCents,
      nextPayoutDate,
      monthToDateRevenueCents,
      outstandingInvoicesCents,
      openInvoiceCount,
      overdueInvoiceCount,
      topClients,
    };
  }

  async listPayments(
    instructorId: string,
    page: number,
    limit: number,
  ): Promise<PaginatedResponse<Payment>> {
    const { rows, count } = await this.paymentModel.findAndCountAll({
      where: { instructorId },
      order: [['createdAt', 'DESC']],
      limit,
      offset: getOffset(page, limit),
    });
    return buildPaginatedResponse(rows, count, page, limit);
  }
}
