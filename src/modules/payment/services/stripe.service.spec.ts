import { InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { makeSilentLogger } from '../../../../test/helpers/sequelize-mocks';

// Capture constructor args. Mock must be hoisted before importing the
// service under test because stripe.service.ts does a side-effectful
// `import = require('stripe')` at module-eval time.
const stripeConstructorMock = jest.fn();
const lastStripeInstance: {
  current: { webhooks: { constructEvent: jest.Mock } } | null;
} = {
  current: null,
};
jest.mock('stripe', () => {
  function Ctor(this: unknown, ...args: unknown[]) {
    stripeConstructorMock(...args);
    const instance = {
      webhooks: {
        constructEvent: jest.fn(() => ({
          id: 'evt_mock',
          type: 'account.updated',
        })),
      },
    };
    lastStripeInstance.current = instance;
    Object.assign(this as object, instance);
    return instance;
  }
  (Ctor as unknown as { default: unknown }).default = Ctor;
  return Ctor;
});

import type { StripeService as StripeServiceType } from './stripe.service';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { StripeService } = require('./stripe.service') as {
  StripeService: new (
    config: ConfigService,
    logger: ReturnType<typeof makeSilentLogger>,
  ) => StripeServiceType;
};

function buildService(env: Record<string, string | undefined>): {
  service: StripeServiceType;
  logger: ReturnType<typeof makeSilentLogger>;
} {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  const logger = makeSilentLogger();
  const service = new StripeService(config, logger);
  return { service, logger };
}

describe('StripeService', () => {
  beforeEach(() => {
    stripeConstructorMock.mockClear();
  });

  it('instantiates the SDK with the pinned API version on onModuleInit', async () => {
    // Sanity-check the Test module wiring path too — proves DI works.
    const logger = makeSilentLogger();
    const config = {
      get: (key: string) =>
        ({
          STRIPE_SECRET_KEY: 'sk_test_abc123',
          STRIPE_API_VERSION: '2026-03-25.dahlia',
          NODE_ENV: 'test',
        })[key],
    } as unknown as ConfigService;

    const moduleRef = await Test.createTestingModule({
      providers: [
        StripeService,
        { provide: ConfigService, useValue: config },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: logger },
      ],
    }).compile();

    const service = moduleRef.get(StripeService);
    service.onModuleInit();

    expect(stripeConstructorMock).toHaveBeenCalledTimes(1);
    const [key, opts] = stripeConstructorMock.mock.calls[0] as [
      string,
      { apiVersion: string },
    ];
    expect(key).toBe('sk_test_abc123');
    expect(opts).toMatchObject({ apiVersion: '2026-03-25.dahlia' });
    expect(service.isConfigured).toBe(true);
  });

  it('throws from `get stripe()` when STRIPE_SECRET_KEY is missing', () => {
    const { service } = buildService({ NODE_ENV: 'test' });
    service.onModuleInit();

    expect(service.isConfigured).toBe(false);
    expect(() => service.stripe).toThrow(InternalServerErrorException);
  });

  it('refuses to boot in production with a test key', () => {
    const { service } = buildService({
      NODE_ENV: 'production',
      STRIPE_SECRET_KEY: 'sk_test_notlive',
    });

    expect(() => service.onModuleInit()).toThrow(/live key/i);
    expect(stripeConstructorMock).not.toHaveBeenCalled();
  });

  it('verifyWebhookSignature delegates to stripe.webhooks.constructEvent', () => {
    const { service } = buildService({
      NODE_ENV: 'test',
      STRIPE_SECRET_KEY: 'sk_test_abc',
      STRIPE_WEBHOOK_SECRET: 'whsec_abc',
    });
    service.onModuleInit();

    const raw = Buffer.from('{"id":"evt_1"}');
    const result = service.verifyWebhookSignature(raw, 't=1,v1=sig');
    expect(result).toEqual({ id: 'evt_mock', type: 'account.updated' });

    expect(
      lastStripeInstance.current!.webhooks.constructEvent,
    ).toHaveBeenCalledWith(raw, 't=1,v1=sig', 'whsec_abc');
  });
});
