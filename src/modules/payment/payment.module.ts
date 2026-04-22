import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';

import { RoleModule } from '../role/role.module';
import { User } from '../user/entities/user.entity';
import { EmailService } from '../../common/services/email.service';

// Entities
import { StripeAccount } from './entities/stripe-account.entity';
import { StripeCustomer } from './entities/stripe-customer.entity';
import { Product } from './entities/product.entity';
import { Subscription } from './entities/subscription.entity';
import { Invoice } from './entities/invoice.entity';
import { Payment } from './entities/payment.entity';
import { WebhookEvent } from './entities/webhook-event.entity';
import { PaymentConsent } from './entities/payment-consent.entity';

// Services
import { StripeService } from './services/stripe.service';
import { WebhookHandlerService } from './services/webhook-handler.service';
import { ConnectService } from './services/connect.service';
import { CustomerService } from './services/customer.service';
import { ProductService } from './services/product.service';
import { InvoiceService } from './services/invoice.service';
import { CheckoutService } from './services/checkout.service';
import { SubscriptionService } from './services/subscription.service';
import { RefundService } from './services/refund.service';
import { EarningsService } from './services/earnings.service';

// Controllers
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentController } from './payment.controller';
import { PaymentClientController } from './payment-client.controller';
import { PaymentPublicController } from './payment-public.controller';

/**
 * PaymentModule
 *
 * Stripe Connect-powered payments for BeeActive.
 *
 * Phase 1 (this module as of today):
 *   - StripeService wrapper (API version pinned, startup assertion)
 *   - WebhookHandlerService with signature verify + idempotency
 *   - PaymentWebhookController (@Public POST /webhooks/stripe)
 *   - All 8 Sequelize entities
 *
 * Phase 2 (pending):
 *   - ConnectService + onboarding endpoints (GET /payments/onboarding/*)
 * Phase 3 (pending):
 *   - CustomerService, ProductService, InvoiceService, CheckoutService
 *   - Instructor + client REST controllers
 * Phase 4 (pending):
 *   - SubscriptionService, Customer Portal link endpoint
 * Phase 5 (pending):
 *   - Refunds + earnings dashboard
 *
 * Notes:
 * - We intentionally do NOT put this behind a REDIS/Bull feature flag
 *   like some existing modules do. Stripe webhooks are processed
 *   synchronously in the HTTP handler in v1. Migration to a queue
 *   is listed under "Future Work" in the plan.
 * - This module has no `imports: [RoleModule]` yet because Phase 1
 *   only exposes the public webhook route. As soon as we add the
 *   instructor/client controllers (Phase 2+), RoleModule goes here.
 */
@Module({
  imports: [
    SequelizeModule.forFeature([
      StripeAccount,
      StripeCustomer,
      Product,
      Subscription,
      Invoice,
      Payment,
      WebhookEvent,
      PaymentConsent,
      User,
    ]),
    RoleModule,
  ],
  controllers: [
    PaymentWebhookController,
    PaymentController,
    PaymentClientController,
    PaymentPublicController,
  ],
  providers: [
    StripeService,
    WebhookHandlerService,
    ConnectService,
    CustomerService,
    ProductService,
    InvoiceService,
    CheckoutService,
    SubscriptionService,
    RefundService,
    EarningsService,
    EmailService,
  ],
  exports: [StripeService, CustomerService],
})
export class PaymentModule {}
