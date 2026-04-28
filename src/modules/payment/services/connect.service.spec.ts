import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Sequelize } from 'sequelize-typescript';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { ConnectService } from './connect.service';
import { StripeService } from './stripe.service';
import { SubscriptionService } from './subscription.service';
import { StripeAccount } from '../entities/stripe-account.entity';
import { User } from '../../user/entities/user.entity';
import {
  NotificationService,
  NotificationType,
} from '../../notification/notification.service';
import {
  fakeTx,
  makeModelMock,
  makeSequelizeMock,
  makeSilentLogger,
  type ModelMock,
} from '../../../../test/helpers/sequelize-mocks';

type StripeAccountStub = {
  id?: string;
  userId: string;
  stripeAccountId: string;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  detailsSubmitted: boolean;
  country: string | null;
  defaultCurrency: string | null;
  disabledReason: string | null;
  requirementsCurrentlyDue: string[] | null;
  onboardingCompletedAt: Date | null;
  disconnectedAt: Date | null;
  save: jest.Mock;
  destroy: jest.Mock;
};

function makeAccountRow(
  overrides: Partial<StripeAccountStub> = {},
): StripeAccountStub {
  return {
    userId: 'user-1',
    stripeAccountId: 'acct_test',
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    country: 'RO',
    defaultCurrency: 'ron',
    disabledReason: null,
    requirementsCurrentlyDue: null,
    onboardingCompletedAt: null,
    disconnectedAt: null,
    save: jest.fn().mockResolvedValue(undefined),
    destroy: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('ConnectService', () => {
  let service: ConnectService;
  let stripeAccountModel: ModelMock;
  let userModel: ModelMock;
  let stripeMock: {
    stripe: {
      accounts: { create: jest.Mock; createLoginLink: jest.Mock };
      accountLinks: { create: jest.Mock };
    };
    buildIdempotencyKey: jest.Mock;
  };
  let notificationMock: { notify: jest.Mock };
  let subscriptionMock: { cancelAllActiveAtPeriodEndForInstructor: jest.Mock };
  let configMock: { get: jest.Mock };

  beforeEach(async () => {
    stripeAccountModel = makeModelMock();
    userModel = makeModelMock();
    // Default: user exists with Stripe-supported country.
    userModel.findByPk.mockResolvedValue({ countryCode: 'RO' });
    stripeMock = {
      stripe: {
        accounts: {
          create: jest.fn(),
          createLoginLink: jest.fn(),
        },
        accountLinks: { create: jest.fn() },
      },
      buildIdempotencyKey: jest.fn(
        (resource, id, op) => `${resource}:${id}:${op}`,
      ),
    };
    notificationMock = { notify: jest.fn().mockResolvedValue(undefined) };
    subscriptionMock = {
      cancelAllActiveAtPeriodEndForInstructor: jest.fn().mockResolvedValue(0),
    };
    configMock = {
      get: jest.fn((key: string, def?: unknown) => {
        if (key === 'DEFAULT_PLATFORM_FEE_BPS') return 0;
        if (key === 'FRONTEND_URL') return 'https://app.test';
        return def;
      }),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ConnectService,
        { provide: getModelToken(StripeAccount), useValue: stripeAccountModel },
        { provide: getModelToken(User), useValue: userModel },
        { provide: Sequelize, useValue: makeSequelizeMock() },
        { provide: StripeService, useValue: stripeMock },
        { provide: SubscriptionService, useValue: subscriptionMock },
        { provide: ConfigService, useValue: configMock },
        { provide: NotificationService, useValue: notificationMock },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = moduleRef.get(ConnectService);
  });

  describe('getOrCreateAccount', () => {
    it('returns existing row without calling Stripe', async () => {
      const existing = makeAccountRow();
      stripeAccountModel.findOne.mockResolvedValue(existing);

      const result = await service.getOrCreateAccount('user-1');

      expect(result).toBe(existing);
      expect(stripeMock.stripe.accounts.create).not.toHaveBeenCalled();
      expect(stripeAccountModel.create).not.toHaveBeenCalled();
    });

    it('creates Stripe account + local row when missing', async () => {
      stripeAccountModel.findOne.mockResolvedValue(null);
      stripeMock.stripe.accounts.create.mockResolvedValue({
        id: 'acct_new',
        charges_enabled: false,
        payouts_enabled: false,
        details_submitted: false,
        country: 'RO',
        default_currency: 'ron',
        requirements: {
          currently_due: ['external_account'],
          disabled_reason: null,
        },
      });
      stripeAccountModel.create.mockResolvedValue(
        makeAccountRow({ stripeAccountId: 'acct_new' }),
      );

      await service.getOrCreateAccount('user-1');

      expect(stripeMock.stripe.accounts.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'express',
          country: 'RO',
          metadata: { beeactive_user_id: 'user-1' },
        }),
        expect.objectContaining({
          idempotencyKey: 'connect_account:user-1:create',
        }),
      );
      expect(stripeAccountModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          stripeAccountId: 'acct_new',
          platformFeeBps: 0,
        }),
        expect.objectContaining({ transaction: undefined }),
      );
    });
  });

  describe('createOnboardingLink', () => {
    it('passes account_onboarding type and falls back to env URLs when none provided', async () => {
      stripeAccountModel.findOne.mockResolvedValue(makeAccountRow());
      stripeMock.stripe.accountLinks.create.mockResolvedValue({
        url: 'https://connect.stripe.com/setup/e/acct_test',
        expires_at: 1_700_000_000,
      });

      const result = await service.createOnboardingLink('user-1');

      expect(stripeMock.stripe.accountLinks.create).toHaveBeenCalledWith({
        account: 'acct_test',
        type: 'account_onboarding',
        return_url: 'https://app.test/coaching/onboarding/return',
        refresh_url: 'https://app.test/coaching/onboarding/refresh',
      });
      expect(result.url).toContain('connect.stripe.com');
      expect(result.expiresAt).toBe(
        new Date(1_700_000_000 * 1000).toISOString(),
      );
    });
  });

  describe('getStatus', () => {
    it('returns canIssueInvoices=true only when chargesEnabled', async () => {
      stripeAccountModel.findOne.mockResolvedValueOnce(
        makeAccountRow({ chargesEnabled: true }),
      );
      const enabled = await service.getStatus('user-1');
      expect(enabled.canIssueInvoices).toBe(true);

      stripeAccountModel.findOne.mockResolvedValueOnce(
        makeAccountRow({ chargesEnabled: false }),
      );
      const disabled = await service.getStatus('user-1');
      expect(disabled.canIssueInvoices).toBe(false);

      stripeAccountModel.findOne.mockResolvedValueOnce(null);
      const missing = await service.getStatus('user-1');
      expect(missing.canIssueInvoices).toBe(false);
      expect(missing.account).toBeNull();
    });
  });

  describe('createDashboardLink', () => {
    it('throws NotFound when no account exists', async () => {
      stripeAccountModel.findOne.mockResolvedValue(null);
      await expect(
        service.createDashboardLink('user-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 422 when details not submitted', async () => {
      stripeAccountModel.findOne.mockResolvedValue(
        makeAccountRow({ detailsSubmitted: false }),
      );
      await expect(
        service.createDashboardLink('user-1'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
    });

    it('returns Stripe login link when ready', async () => {
      stripeAccountModel.findOne.mockResolvedValue(
        makeAccountRow({ detailsSubmitted: true }),
      );
      stripeMock.stripe.accounts.createLoginLink.mockResolvedValue({
        url: 'https://connect.stripe.com/express/abc',
      });
      const result = await service.createDashboardLink('user-1');
      expect(result.url).toBe('https://connect.stripe.com/express/abc');
    });
  });

  describe('syncAccountFromWebhook', () => {
    it('fires STRIPE_ACCOUNT_READY when chargesEnabled flips false→true', async () => {
      const row = makeAccountRow({
        chargesEnabled: false,
        detailsSubmitted: false,
      });
      stripeAccountModel.findOne.mockResolvedValue(row);

      await service.syncAccountFromWebhook(
        {
          id: 'acct_test',
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          country: 'RO',
          default_currency: 'ron',
          requirements: { currently_due: [], disabled_reason: null },
        } as never,
        fakeTx as never,
      );

      expect(row.chargesEnabled).toBe(true);
      expect(row.onboardingCompletedAt).toBeInstanceOf(Date);
      expect(row.save).toHaveBeenCalledWith({ transaction: fakeTx });
      expect(notificationMock.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          type: NotificationType.STRIPE_ACCOUNT_READY,
        }),
      );
    });

    it('does NOT fire notification when chargesEnabled was already true', async () => {
      const row = makeAccountRow({
        chargesEnabled: true,
        detailsSubmitted: true,
      });
      stripeAccountModel.findOne.mockResolvedValue(row);

      await service.syncAccountFromWebhook(
        {
          id: 'acct_test',
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          country: 'RO',
          default_currency: 'ron',
          requirements: { currently_due: [], disabled_reason: null },
        } as never,
        fakeTx as never,
      );

      expect(notificationMock.notify).not.toHaveBeenCalled();
    });

    it('fires STRIPE_ACCOUNT_RESTRICTED when disabledReason appears', async () => {
      const row = makeAccountRow({
        chargesEnabled: true,
        detailsSubmitted: true,
        disabledReason: null,
      });
      stripeAccountModel.findOne.mockResolvedValue(row);

      await service.syncAccountFromWebhook(
        {
          id: 'acct_test',
          charges_enabled: true,
          payouts_enabled: true,
          details_submitted: true,
          country: 'RO',
          default_currency: 'ron',
          requirements: {
            currently_due: ['individual.verification.document'],
            disabled_reason: 'requirements.past_due',
          },
        } as never,
        fakeTx as never,
      );

      expect(row.disabledReason).toBe('requirements.past_due');
      expect(notificationMock.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.STRIPE_ACCOUNT_RESTRICTED,
        }),
      );
    });

    it('logs and returns when local row missing (no throw)', async () => {
      stripeAccountModel.findOne.mockResolvedValue(null);
      await expect(
        service.syncAccountFromWebhook(
          { id: 'acct_unknown' } as never,
          fakeTx as never,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('handleDeauthorized', () => {
    it('cancels active subs at-period-end, deletes the local row, and notifies', async () => {
      const row = makeAccountRow({
        chargesEnabled: true,
        payoutsEnabled: true,
      });
      stripeAccountModel.findOne.mockResolvedValue(row);
      subscriptionMock.cancelAllActiveAtPeriodEndForInstructor.mockResolvedValue(
        3,
      );

      await service.handleDeauthorized('acct_test', fakeTx as never);

      // 1) Subscriptions cancelled
      expect(
        subscriptionMock.cancelAllActiveAtPeriodEndForInstructor,
      ).toHaveBeenCalledWith('user-1', fakeTx);
      // 2) Local row deleted (NOT just flagged disconnected — deleted so reconnect works cleanly)
      expect(row.destroy).toHaveBeenCalledWith({ transaction: fakeTx });
      expect(row.save).not.toHaveBeenCalled();
      // 3) Instructor notified
      expect(notificationMock.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.STRIPE_ACCOUNT_RESTRICTED,
          userId: 'user-1',
        }),
      );
    });

    it('logs and returns when local row missing (no throw, no sub cancellation)', async () => {
      stripeAccountModel.findOne.mockResolvedValue(null);

      await expect(
        service.handleDeauthorized('acct_unknown', fakeTx as never),
      ).resolves.toBeUndefined();

      expect(
        subscriptionMock.cancelAllActiveAtPeriodEndForInstructor,
      ).not.toHaveBeenCalled();
      expect(notificationMock.notify).not.toHaveBeenCalled();
    });

    it('handles zero active subs (notification still goes out)', async () => {
      const row = makeAccountRow();
      stripeAccountModel.findOne.mockResolvedValue(row);
      subscriptionMock.cancelAllActiveAtPeriodEndForInstructor.mockResolvedValue(
        0,
      );

      await service.handleDeauthorized('acct_test', fakeTx as never);

      expect(row.destroy).toHaveBeenCalled();
      expect(notificationMock.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.STRIPE_ACCOUNT_RESTRICTED,
        }),
      );
    });
  });
});
