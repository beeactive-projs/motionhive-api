import {
  Injectable,
  Inject,
  OnModuleInit,
  InternalServerErrorException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
// stripe-node v22 + nodenext moduleResolution quirk:
//
// The package root ('stripe') resolves to cjs/stripe.cjs.node.d.ts
// which does `export = StripeConstructor`, and that StripeConstructor
// namespace does NOT carry the resource types (Event, Account,
// StripeConfig, …). Those live on a SEPARATE `class + namespace Stripe`
// declaration merge inside cjs/stripe.core.d.ts, which is not re-exported
// at the package root.
//
// To get the resource type namespace we import the type from stripe.core
// and the runtime constructor from the package root. DO NOT call
// `new` on the `stripe.core` Stripe class — that class is unwired and
// will throw at runtime. The runtime constructor is `StripeConstructor`.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import StripeConstructor = require('stripe');
import type { Stripe } from 'stripe-types';

/**
 * StripeService — thin wrapper around the Stripe SDK.
 *
 * Responsibilities:
 * 1. Instantiate ONE Stripe client with a pinned API version
 * 2. Expose it via `stripe` getter to the rest of PaymentModule
 * 3. Run a startup assertion so mis-configured environments crash
 *    immediately instead of at first request
 * 4. Expose small helpers that encode the tricky Stripe rules we
 *    can't afford to get wrong:
 *       - buildFeeParams:  omits application_fee_amount when fee = 0
 *                          (Stripe REJECTS 0 as an explicit value)
 *       - buildIdempotencyKey: stable key for retryable writes
 *       - verifyWebhookSignature: wraps stripe.webhooks.constructEvent
 *
 * Design notes:
 * - We never call Stripe directly from controllers or services other
 *   than through this class (and the domain services that depend on
 *   it). That makes it trivially mockable in tests and gives us a
 *   single choke point for logging + metrics later.
 * - API version is PINNED in env (`STRIPE_API_VERSION`). Stripe
 *   deprecates API versions on a schedule; we update the pinned value
 *   as a deliberate, reviewed change — never rely on the SDK default.
 */
@Injectable()
export class StripeService implements OnModuleInit {
  private _stripe: Stripe | null = null;
  private _isConfigured = false;

  constructor(
    private readonly configService: ConfigService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Startup assertion + lazy client init.
   *
   * Rules enforced:
   * - In production, STRIPE_SECRET_KEY MUST be set.
   * - In production, the key MUST start with `sk_live_`. A test key
   *   in production = refuse to boot.
   * - In non-production, a live key is a misconfiguration. Refuse to
   *   boot so nobody accidentally mixes real customers with a dev DB.
   * - If no key is set in non-production we log a warning and let the
   *   app boot without Stripe (useful for local UI/dev work that
   *   doesn't touch payments).
   */
  onModuleInit(): void {
    const secretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    // Default pinned API version. Keep this in sync with stripe-node's
    // `apiVersion.d.ts` pin on SDK upgrades — Stripe rejects unknown
    // versions with "Unrecognized request URL (Invalid API Version)".
    const apiVersion =
      this.configService.get<string>('STRIPE_API_VERSION') ??
      '2026-03-25.dahlia';
    const nodeEnv = this.configService.get<string>('NODE_ENV') ?? 'development';

    if (!secretKey) {
      if (nodeEnv === 'production') {
        throw new Error(
          'STRIPE_SECRET_KEY is required in production. Refusing to boot.',
        );
      }
      this.logger.warn(
        'STRIPE_SECRET_KEY not set — PaymentModule will be disabled. ' +
          'Set the env var to enable Stripe integration.',
        'StripeService',
      );
      return;
    }

    // Production must use live keys, non-prod must use test keys.
    // Escape hatch: STRIPE_ALLOW_TEST_KEY_IN_PROD=true lets a prod-like env
    // (e.g. a staging deploy still pointed at Stripe test mode) boot with
    // an sk_test_ key. Loud warning so nobody forgets to flip it off.
    const allowTestKeyInProd =
      this.configService.get<string>('STRIPE_ALLOW_TEST_KEY_IN_PROD') ===
      'true';
    if (nodeEnv === 'production' && !secretKey.startsWith('sk_live_')) {
      if (!allowTestKeyInProd) {
        throw new Error(
          'STRIPE_SECRET_KEY must be a live key (sk_live_...) in production. ' +
            'Refusing to boot with a test key. ' +
            'Set STRIPE_ALLOW_TEST_KEY_IN_PROD=true to override (staging use only).',
        );
      }
      this.logger.warn(
        'STRIPE_ALLOW_TEST_KEY_IN_PROD=true — booting production with a Stripe TEST key. ' +
          'No real charges will be processed. Disable this flag before going live.',
        'StripeService',
      );
    }
    if (nodeEnv !== 'production' && secretKey.startsWith('sk_live_')) {
      throw new Error(
        `STRIPE_SECRET_KEY is a live key but NODE_ENV=${nodeEnv}. ` +
          'Refusing to boot — never mix live Stripe keys with non-production environments.',
      );
    }

    this._stripe = new StripeConstructor(secretKey, {
      // apiVersion is pinned via env. The SDK types it as a literal
      // union of known versions; we read from env at runtime so we
      // cast through unknown. The value is validated in Joi env schema.
      apiVersion: apiVersion as unknown as NonNullable<
        ConstructorParameters<typeof StripeConstructor>[1]
      >['apiVersion'],
      appInfo: {
        name: 'BeeActive',
        version: '1.0.0',
        url: 'https://motionhive.fit',
      },
      // Typed errors help us distinguish signature / card / idempotency errors.
      typescript: true,
      // Retry transient network errors once. Stripe guarantees idempotent
      // retries when we pass an Idempotency-Key header.
      maxNetworkRetries: 1,
    });
    this._isConfigured = true;

    this.logger.log(
      `Stripe initialized (api version ${apiVersion}, env ${nodeEnv})`,
      'StripeService',
    );
  }

  /**
   * TRUE when Stripe is usable. Other services can guard entry points
   * with this to return a clean "payments not configured" error
   * instead of blowing up on a null client.
   */
  get isConfigured(): boolean {
    return this._isConfigured;
  }

  /**
   * Raw SDK client. Throws if the module never initialized properly.
   * Callers should handle the error or check `isConfigured` first.
   */
  get stripe(): Stripe {
    if (!this._stripe) {
      throw new InternalServerErrorException(
        'Stripe is not configured. STRIPE_SECRET_KEY is missing.',
      );
    }
    return this._stripe;
  }

  /**
   * Webhook secret for signature verification. Throws if missing so
   * we never accept unsigned webhook traffic.
   */
  get webhookSecret(): string {
    const secret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret) {
      throw new InternalServerErrorException(
        'STRIPE_WEBHOOK_SECRET is missing. Cannot verify webhook signatures.',
      );
    }
    return secret;
  }

  /**
   * Verify a Stripe webhook signature.
   *
   * @param rawBody the raw request Buffer preserved by the express.raw
   *                middleware in main.ts — NOT a re-serialized string
   * @param signatureHeader value of the `stripe-signature` header
   * @returns the parsed, verified Stripe.Event
   * @throws Stripe.errors.StripeSignatureVerificationError on bad sig
   *
   * SECURITY: never wrap this call in generic try/catch that swallows
   * the error. Let the signature-verification error propagate so the
   * webhook controller can return HTTP 400 (tells Stripe to retry is
   * pointless). Returning 200 on a bad signature would silently hide
   * attacks.
   */
  verifyWebhookSignature(
    rawBody: Buffer,
    signatureHeader: string,
  ): Stripe.Event {
    return this.stripe.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      this.webhookSecret,
    );
  }

  /**
   * Build the application_fee_amount parameter correctly.
   *
   * Stripe REJECTS `application_fee_amount: 0` with an API error.
   * When the per-instructor fee is 0 we must OMIT the parameter
   * entirely. This helper encapsulates the rule so every call site
   * gets it right.
   *
   * @param amountCents gross amount being charged
   * @param feeBps      basis points fee (0 = 0%, 100 = 1%)
   * @returns
   *   `{}`                           when fee is 0
   *   `{ application_fee_amount: n }` otherwise, floored
   */
  buildFeeParams(
    amountCents: number,
    feeBps: number,
  ): { application_fee_amount?: number } {
    if (!feeBps || feeBps <= 0) return {};
    const fee = Math.floor((amountCents * feeBps) / 10000);
    // Fee must be strictly > 0 after flooring or Stripe will still reject.
    if (fee <= 0) return {};
    return { application_fee_amount: fee };
  }

  /**
   * Build a deterministic idempotency key for write operations.
   *
   * Stripe supports `Idempotency-Key` on all POST requests. Passing a
   * stable key means retries (ours OR the SDK's network retry) never
   * produce duplicate charges/invoices.
   *
   * Convention: `<resource>:<local-id>:<operation>`
   *   e.g. "invoice:abc-123:create"
   */
  buildIdempotencyKey(
    resource: string,
    localId: string,
    operation: string,
  ): string {
    return `${resource}:${localId}:${operation}`;
  }
}
