import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Sequelize } from 'sequelize-typescript';

import { SubscriptionService } from './subscription.service';
import {
  Subscription,
  SubscriptionStatus,
} from '../entities/subscription.entity';
import { Product, ProductType } from '../entities/product.entity';
import { StripeAccount } from '../entities/stripe-account.entity';
import { User } from '../../user/entities/user.entity';
import { StripeService } from './stripe.service';
import { CustomerService } from './customer.service';
import { EmailService } from '../../../common/services/email.service';
import { NotificationService } from '../../notification/notification.service';
import {
  makeModelMock,
  makeSequelizeMock,
  makeSilentLogger,
  type ModelMock,
} from '../../../../test/helpers/sequelize-mocks';

/**
 * Focused on the push-model subscription flow and its webhook
 * counterpart. The pre-existing create / cancel / sync paths are
 * exercised in production usage; we add coverage as we touch new
 * behavior rather than back-filling everything at once.
 */
describe('SubscriptionService — push-model setup flow', () => {
  let service: SubscriptionService;
  let subscriptionModel: ModelMock;
  let productModel: ModelMock;
  let stripeAccountModel: ModelMock;
  let userModel: ModelMock;
  let stripeMock: {
    stripe: {
      customers: { retrieve: jest.Mock; update: jest.Mock };
      subscriptions: {
        create: jest.Mock;
        retrieve: jest.Mock;
        update: jest.Mock;
      };
      checkout: { sessions: { create: jest.Mock } };
      invoices: { pay: jest.Mock };
    };
    buildIdempotencyKey: jest.Mock;
  };
  let customerServiceMock: { getOrCreateForUser: jest.Mock };
  let emailServiceMock: { sendSubscriptionSetupEmail: jest.Mock };
  let notificationMock: { notify: jest.Mock };
  let configMock: { get: jest.Mock };

  function makeProduct(overrides: Partial<Product> = {}): Product {
    return {
      id: 'prod-1',
      instructorId: 'user-1',
      type: ProductType.SUBSCRIPTION,
      stripePriceId: 'price_test',
      name: 'Personal trainings',
      amountCents: 10_000,
      currency: 'RON',
      interval: 'month',
      intervalCount: 1,
      ...overrides,
    } as unknown as Product;
  }

  function makeSubscription(
    overrides: Partial<Subscription> = {},
  ): Subscription {
    return {
      id: 'sub-1',
      instructorId: 'user-1',
      clientId: 'client-1',
      stripeCustomerId: 'cus_test',
      stripeSubscriptionId: 'sub_test',
      stripePriceId: 'price_test',
      status: SubscriptionStatus.INCOMPLETE,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAt: null,
      canceledAt: null,
      cancelAtPeriodEnd: false,
      trialStart: null,
      trialEnd: null,
      amountCents: 10_000,
      currency: 'RON',
      save: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    } as unknown as Subscription;
  }

  beforeEach(async () => {
    subscriptionModel = makeModelMock();
    productModel = makeModelMock();
    stripeAccountModel = makeModelMock();
    userModel = makeModelMock();

    stripeMock = {
      stripe: {
        customers: {
          retrieve: jest.fn().mockResolvedValue({
            id: 'cus_test',
            invoice_settings: { default_payment_method: null },
          }),
          update: jest.fn().mockResolvedValue({}),
        },
        subscriptions: {
          create: jest.fn(),
          retrieve: jest.fn().mockResolvedValue({ id: 'sub_test' }),
          update: jest.fn().mockResolvedValue({}),
        },
        checkout: {
          sessions: {
            create: jest
              .fn()
              .mockResolvedValue({ url: 'https://checkout.stripe.com/c/test' }),
          },
        },
        invoices: { pay: jest.fn().mockResolvedValue({}) },
      },
      buildIdempotencyKey: jest.fn(
        (resource, id, op) => `${resource}:${id}:${op}`,
      ),
    };

    customerServiceMock = {
      getOrCreateForUser: jest
        .fn()
        .mockResolvedValue({ stripeCustomerId: 'cus_test' }),
    };
    emailServiceMock = {
      sendSubscriptionSetupEmail: jest.fn().mockResolvedValue(undefined),
    };
    notificationMock = { notify: jest.fn().mockResolvedValue(undefined) };
    configMock = {
      get: jest.fn((key: string, def?: unknown) => {
        if (key === 'FRONTEND_URL') return 'https://app.test';
        return def;
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SubscriptionService,
        { provide: getModelToken(Subscription), useValue: subscriptionModel },
        { provide: getModelToken(Product), useValue: productModel },
        { provide: getModelToken(StripeAccount), useValue: stripeAccountModel },
        { provide: getModelToken(User), useValue: userModel },
        { provide: Sequelize, useValue: makeSequelizeMock() },
        { provide: StripeService, useValue: stripeMock },
        { provide: CustomerService, useValue: customerServiceMock },
        { provide: EmailService, useValue: emailServiceMock },
        { provide: NotificationService, useValue: notificationMock },
        { provide: ConfigService, useValue: configMock },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = moduleRef.get(SubscriptionService);
  });

  describe('create — always-confirm policy on paid subs', () => {
    beforeEach(() => {
      stripeAccountModel.findOne.mockResolvedValue({
        userId: 'user-1',
        stripeAccountId: 'acct_test',
        chargesEnabled: true,
        platformFeeBps: 0,
      });
      productModel.findByPk.mockResolvedValue(makeProduct());
      subscriptionModel.findOne.mockResolvedValue(null); // no duplicate
      subscriptionModel.create.mockResolvedValue(makeSubscription());
      // Stripe returns INCOMPLETE for any non-trial paid sub (we always
      // pass `payment_behavior: default_incomplete` now). The
      // `latest_invoice` carries the hosted page URL we email.
      stripeMock.stripe.subscriptions.create.mockResolvedValue({
        id: 'sub_test',
        status: 'incomplete',
        latest_invoice: {
          id: 'in_test',
          status: 'open',
          hosted_invoice_url: 'https://invoice.stripe.com/i/abc',
        },
      });
      userModel.findByPk.mockImplementation((id: string) => {
        if (id === 'client-1')
          return Promise.resolve({
            id: 'client-1',
            email: 'client@example.com',
            firstName: 'Ana',
          });
        if (id === 'user-1')
          return Promise.resolve({
            id: 'user-1',
            firstName: 'John',
            lastName: 'Doe',
          });
        return Promise.resolve(null);
      });
    });

    it('always sets payment_behavior=default_incomplete on paid subs', async () => {
      await service.create('user-1', {
        clientUserId: 'client-1',
        productId: 'prod-1',
      } as never);

      const subParams = stripeMock.stripe.subscriptions.create.mock.calls[0][0];
      expect(subParams.payment_behavior).toBe('default_incomplete');
      // Expand needed so we can read latest_invoice.hosted_invoice_url
      // off the response.
      expect(subParams.expand).toContain('latest_invoice');
    });

    it('emails the client the invoice hosted URL as confirmation', async () => {
      const result = await service.create('user-1', {
        clientUserId: 'client-1',
        productId: 'prod-1',
      } as never);

      expect(emailServiceMock.sendSubscriptionSetupEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'client@example.com',
          planName: 'Personal trainings',
          setupUrl: 'https://invoice.stripe.com/i/abc',
        }),
      );
      expect(
        (result as Subscription & { pendingConfirmationUrl?: string | null })
          .pendingConfirmationUrl,
      ).toBe('https://invoice.stripe.com/i/abc');
    });

    it('does NOT fail subscription create when the email throws', async () => {
      emailServiceMock.sendSubscriptionSetupEmail.mockRejectedValue(
        new Error('SMTP boom'),
      );

      await expect(
        service.create('user-1', {
          clientUserId: 'client-1',
          productId: 'prod-1',
        } as never),
      ).resolves.toBeDefined();
    });

    it('still requires confirmation EVEN when the customer already has a saved card', async () => {
      // The card-on-file shortcut from the previous push-model is gone.
      // Even with a default PM, every new sub goes through the hosted
      // confirmation page so the client opts in per-subscription.
      stripeMock.stripe.customers.retrieve.mockResolvedValue({
        id: 'cus_test',
        invoice_settings: { default_payment_method: 'pm_test' },
      });

      await service.create('user-1', {
        clientUserId: 'client-1',
        productId: 'prod-1',
      } as never);

      const subParams = stripeMock.stripe.subscriptions.create.mock.calls[0][0];
      expect(subParams.payment_behavior).toBe('default_incomplete');
      expect(emailServiceMock.sendSubscriptionSetupEmail).toHaveBeenCalled();
    });
  });

  describe('create — trial subscription', () => {
    it('does NOT use default_incomplete (trial defers payment)', async () => {
      stripeAccountModel.findOne.mockResolvedValue({
        userId: 'user-1',
        stripeAccountId: 'acct_test',
        chargesEnabled: true,
        platformFeeBps: 0,
      });
      productModel.findByPk.mockResolvedValue(makeProduct());
      subscriptionModel.findOne.mockResolvedValue(null);
      subscriptionModel.create.mockResolvedValue(makeSubscription());
      stripeMock.stripe.subscriptions.create.mockResolvedValue({
        id: 'sub_test',
        status: 'trialing',
      });

      await service.create('user-1', {
        clientUserId: 'client-1',
        productId: 'prod-1',
        trialDays: 14,
      } as never);

      const subParams = stripeMock.stripe.subscriptions.create.mock.calls[0][0];
      expect(subParams.payment_behavior).toBeUndefined();
      expect(subParams.trial_period_days).toBe(14);
      expect(
        emailServiceMock.sendSubscriptionSetupEmail,
      ).not.toHaveBeenCalled();
    });
  });

  describe('getConfirmationLink', () => {
    it('returns null URL when subscription is no longer INCOMPLETE', async () => {
      subscriptionModel.findByPk.mockResolvedValue(
        makeSubscription({ status: SubscriptionStatus.ACTIVE }),
      );

      const result = await service.getConfirmationLink('user-1', 'sub-1');
      expect(result).toEqual({ url: null, status: SubscriptionStatus.ACTIVE });
      expect(stripeMock.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    });

    it("returns the latest_invoice's hosted URL when INCOMPLETE", async () => {
      subscriptionModel.findByPk.mockResolvedValue(makeSubscription());
      stripeMock.stripe.subscriptions.retrieve.mockResolvedValue({
        id: 'sub_test',
        latest_invoice: {
          id: 'in_test',
          status: 'open',
          hosted_invoice_url: 'https://invoice.stripe.com/i/fresh',
        },
      });

      const result = await service.getConfirmationLink('user-1', 'sub-1');
      expect(result.url).toBe('https://invoice.stripe.com/i/fresh');
      expect(stripeMock.stripe.subscriptions.retrieve).toHaveBeenCalledWith(
        'sub_test',
        expect.objectContaining({ expand: ['latest_invoice'] }),
      );
    });
  });
});
