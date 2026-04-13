import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
// Runtime import for the `errors.StripeSignatureVerificationError`
// class (needed for instanceof check). See stripe.service.ts for why
// this uses `import = require` instead of ESM default import.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import StripeConstructor = require('stripe');
import type { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { WebhookHandlerService } from './services/webhook-handler.service';

/**
 * PaymentWebhookController
 *
 * The ONLY endpoint that accepts traffic directly from Stripe's
 * servers. It is:
 *   - @Public  (no JWT)
 *   - @SkipThrottle (Stripe controls the call rate, not us)
 *   - Reading the RAW request body (Buffer), not parsed JSON
 *
 * The raw body is preserved by the express.raw middleware registered
 * in main.ts on this exact path:
 *
 *     app.use('/webhooks/stripe', express.raw({ type: 'application/json' }));
 *
 * Status code policy:
 *   200  → event accepted (even if duplicated or ignored)
 *   400  → signature verification failed — DO NOT return 200, or
 *          Stripe will stop retrying and we'll never notice a bug
 *   500  → handler error — Stripe will retry
 *
 * Logging policy: never log event.data.object (PII). Log event.id
 * and event.type only.
 */
@ApiTags('Payments (Webhooks)')
@Controller('webhooks/stripe')
export class PaymentWebhookController {
  constructor(
    private readonly webhookHandler: WebhookHandlerService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * POST /webhooks/stripe
   *
   * The signature header name is `stripe-signature`. NestJS exposes
   * headers via the @Headers() decorator; header keys are lowercased
   * by Node.
   */
  @Post()
  @Public()
  @SkipThrottle()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Stripe webhook receiver',
    description:
      'Receives raw Stripe webhook events. Signature-verified via ' +
      '`stripe-signature` header against STRIPE_WEBHOOK_SECRET. ' +
      'Not called by the frontend — only by Stripe servers.\n\n' +
      'Status codes:\n' +
      '- 200: event accepted (new or duplicate)\n' +
      '- 400: signature verification failed\n' +
      '- 500: handler error (Stripe will retry)',
  })
  @ApiResponse({ status: 200, description: 'Event accepted' })
  @ApiResponse({ status: 400, description: 'Invalid signature' })
  async handleStripeWebhook(
    @Req() req: Request,
    @Headers('stripe-signature') signatureHeader: string,
  ): Promise<{ received: true; eventId: string; duplicate: boolean }> {
    if (!signatureHeader) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    // With express.raw() middleware, req.body is a Buffer of the raw
    // request bytes — exactly what Stripe signed. Anything else (an
    // object, a string) means the middleware isn't wired correctly.
    const rawBody = req.body as unknown;
    if (!Buffer.isBuffer(rawBody)) {
      this.logger.error(
        'Stripe webhook body is not a Buffer — express.raw middleware is not registered for /webhooks/stripe. ' +
          'See main.ts.',
        undefined,
        'PaymentWebhookController',
      );
      throw new BadRequestException('Invalid webhook payload');
    }

    try {
      const result = await this.webhookHandler.handleIncomingEvent(
        rawBody,
        signatureHeader,
      );
      return {
        received: true,
        eventId: result.eventId,
        duplicate: result.duplicate,
      };
    } catch (err) {
      // Signature verification failures → HTTP 400 so Stripe stops
      // retrying (there's nothing to retry — our secret is wrong or
      // the request is forged). All other errors propagate and turn
      // into 500s, which Stripe DOES retry.
      if (
        err instanceof StripeConstructor.errors.StripeSignatureVerificationError
      ) {
        this.logger.warn(
          `Stripe webhook signature verification failed: ${err.message}`,
          'PaymentWebhookController',
        );
        throw new BadRequestException('Invalid webhook signature');
      }
      throw err;
    }
  }
}
