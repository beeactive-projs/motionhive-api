import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Sequelize } from 'sequelize-typescript';

import { Invoice, InvoiceStatus } from '../entities/invoice.entity';
import {
  ConsentType,
  PaymentConsent,
} from '../entities/payment-consent.entity';
import { StripeService } from './stripe.service';
import { CustomerService } from './customer.service';
import { CreateCheckoutDto } from '../dto/create-checkout.dto';

/**
 * Canonical waiver text saved to `payment_consent`. Bilingual on purpose:
 * the frontend shows whichever language the client picked, but the legal
 * audit log always records both so we don't depend on which UI locale the
 * client happened to have active.
 */
const IMMEDIATE_ACCESS_WAIVER_TEXT =
  'RO: Sunt de acord cu accesul imediat la serviciu și renunț la dreptul ' +
  'meu de retragere de 14 zile (OUG 34/2014). | ' +
  'EN: I agree to immediate access to the service and waive my 14-day ' +
  'right of withdrawal (Romanian OUG 34/2014).';

/**
 * CheckoutService
 *
 * Two flows:
 *   - createInvoiceCheckoutSession — client clicks "Pay invoice"
 *   - createCustomerPortalLink     — client manages cards / subs
 *   - createSetupIntent            — client saves a card without paying
 *
 * EU Consumer Rights Directive (Romanian OUG 34/2014): if the invoice is
 * marked `requiresImmediateAccessWaiver=true`, the client MUST tick the
 * 14-day cooling-off waiver checkbox. We record the consent in
 * payment_consent BEFORE creating the Stripe Checkout session, with the
 * exact text shown, the client's IP, and the user agent — this is the
 * legal audit trail.
 */
@Injectable()
export class CheckoutService {
  constructor(
    @InjectModel(Invoice)
    private readonly invoiceModel: typeof Invoice,
    @InjectModel(PaymentConsent)
    private readonly paymentConsentModel: typeof PaymentConsent,
    private readonly sequelize: Sequelize,
    private readonly stripeService: StripeService,
    private readonly customerService: CustomerService,
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async createInvoiceCheckoutSession(
    invoiceId: string,
    clientUserId: string,
    dto: CreateCheckoutDto,
    requestContext: { ip?: string; userAgent?: string },
  ): Promise<{ url: string }> {
    const invoice = await this.invoiceModel.findByPk(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found.');
    if (invoice.clientId !== clientUserId) {
      throw new ForbiddenException('You cannot pay this invoice.');
    }
    if (invoice.status === InvoiceStatus.PAID) {
      throw new BadRequestException('Invoice already paid.');
    }
    if (invoice.status === InvoiceStatus.VOID) {
      throw new BadRequestException('Invoice has been voided.');
    }

    // EU waiver gating + audit log.
    if (invoice.requiresImmediateAccessWaiver) {
      if (!dto.immediateAccessWaiverAccepted) {
        throw new BadRequestException(
          'You must accept the immediate-access waiver to pay this invoice.',
        );
      }
      const tx = await this.sequelize.transaction();
      try {
        await this.paymentConsentModel.create(
          {
            invoiceId: invoice.id,
            userId: clientUserId,
            consentType: ConsentType.IMMEDIATE_ACCESS_WAIVER,
            consentText: IMMEDIATE_ACCESS_WAIVER_TEXT,
            ipAddress: requestContext.ip ?? null,
            userAgent: requestContext.userAgent ?? null,
          },
          { transaction: tx },
        );
        invoice.waiverAcceptedAt = new Date();
        await invoice.save({ transaction: tx });
        await tx.commit();
      } catch (err) {
        try {
          await tx.rollback();
        } catch {
          // ignore
        }
        throw err;
      }
    }

    // The hosted invoice URL IS the payment page for invoice-billed flows.
    // We don't actually need a Checkout Session for plain invoices — we
    // return the hosted URL. We keep the method name + DTO so the front-end
    // doesn't care about the implementation detail.
    if (!invoice.hostedInvoiceUrl) {
      throw new BadRequestException(
        'Invoice is not finalized yet. Ask the instructor to send it.',
      );
    }
    return { url: invoice.hostedInvoiceUrl };
  }

  async createSetupIntent(userId: string): Promise<{ clientSecret: string }> {
    const customer = await this.customerService.getOrCreateForUser(userId);
    const intent = await this.stripeService.stripe.setupIntents.create({
      customer: customer.stripeCustomerId,
      usage: 'off_session',
    });
    if (!intent.client_secret) {
      throw new BadRequestException('Failed to create SetupIntent.');
    }
    return { clientSecret: intent.client_secret };
  }

  async createCustomerPortalLink(userId: string): Promise<{ url: string }> {
    const customer = await this.customerService.getOrCreateForUser(userId);
    const frontendUrl =
      this.configService.get<string>('FRONTEND_URL') ?? 'http://localhost:4200';
    const portal =
      await this.stripeService.stripe.billingPortal.sessions.create({
        customer: customer.stripeCustomerId,
        return_url: `${frontendUrl}/client/billing`,
      });
    return { url: portal.url };
  }
}
