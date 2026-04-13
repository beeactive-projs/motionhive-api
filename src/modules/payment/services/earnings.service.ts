import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import { Payment, PaymentStatus } from '../entities/payment.entity';
import { StripeAccount } from '../entities/stripe-account.entity';
import {
  buildPaginatedResponse,
  getOffset,
  PaginatedResponse,
} from '../../../common/dto/pagination.dto';

export interface EarningsSummary {
  totalEarnedCents: number;
  monthToDateCents: number;
  outstandingInvoiceCents: number;
  outstandingInvoiceCount: number;
  currency: string;
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
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async getSummary(instructorId: string): Promise<EarningsSummary> {
    const [totalResult] = (await this.paymentModel.findAll({
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
      },
      raw: true,
    })) as unknown as { total: number }[];

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

    const outstandingInvoices = await this.invoiceModel.findAndCountAll({
      attributes: ['amountRemainingCents'],
      where: {
        instructorId,
        status: InvoiceStatus.OPEN,
      },
      raw: true,
    });
    const outstandingCents = outstandingInvoices.rows.reduce(
      (sum: number, r: { amountRemainingCents: number }) =>
        sum + (r.amountRemainingCents ?? 0),
      0,
    );

    const account = await this.stripeAccountModel.findOne({
      where: { userId: instructorId },
      attributes: ['defaultCurrency'],
    });
    const currency = (account?.defaultCurrency ?? 'ron').toUpperCase();

    return {
      totalEarnedCents: Number(totalResult?.total ?? 0),
      monthToDateCents: Number(mtdResult?.total ?? 0),
      outstandingInvoiceCents: outstandingCents,
      outstandingInvoiceCount: outstandingInvoices.count,
      currency,
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
