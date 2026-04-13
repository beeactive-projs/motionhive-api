/**
 * Swagger documentation for the Payments & Invoicing surface.
 *
 * Phase 1 status: only the webhook is live. The instructor + client
 * endpoint blocks are scaffolded so the next phases can fill them in
 * without re-structuring the file.
 *
 * Namespace layout mirrors session.docs.ts:
 *   - PaymentDocs.<endpoint>   — everything you can @ApiEndpoint() on
 *     a controller method
 *
 * Naming convention:
 *   onboardingStart       — POST  /payments/onboarding/start
 *   onboardingStatus      — GET   /payments/onboarding/status
 *   onboardingDashboard   — POST  /payments/onboarding/dashboard-link
 *   createProduct         — POST  /payments/products
 *   listProducts          — GET   /payments/products
 *   ...
 */

import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

export const PaymentDocs = {
  // =====================================================================
  // WEBHOOK (Phase 1 — live)
  // =====================================================================
  // The webhook controller uses @ApiOperation directly (see
  // PaymentWebhookController) because it's @Public and doesn't fit the
  // @ApiEndpoint() pattern cleanly. Kept here as a reference stub.

  // =====================================================================
  // ONBOARDING (Phase 2)
  // =====================================================================

  onboardingStart: {
    summary: 'Start Stripe Connect Express onboarding',
    description:
      'Creates a Stripe Connect Express account for the authenticated ' +
      'instructor (if one does not already exist) and returns a hosted ' +
      'onboarding Account Link URL. The instructor completes KYC + bank ' +
      'details on Stripe-hosted pages; BeeActive never sees banking info.\n\n' +
      'Rate limited to 5 calls/hour per user.\n\n' +
      '**Frontend flow:** redirect `window.location.href = response.url`. ' +
      'Stripe redirects back to `returnUrl` (e.g. /instructor/payments/onboarding-complete) ' +
      'once the user finishes — or bails early.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Onboarding link created',
        example: {
          url: 'https://connect.stripe.com/setup/e/acct_1...',
          expiresAt: '2026-04-11T15:30:00.000Z',
        },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  onboardingStatus: {
    summary: 'Get my Stripe onboarding status',
    description:
      "Returns the instructor's local `stripe_account` row (mirrored " +
      'from Stripe via the account.updated webhook). Used to drive the ' +
      'status badge in the instructor dashboard ("Ready", "In review", ' +
      '"Action required").',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Status returned',
        example: {
          stripeAccountId: 'acct_1ExampleXYZ',
          chargesEnabled: true,
          payoutsEnabled: true,
          detailsSubmitted: true,
          disabledReason: null,
          requirementsCurrentlyDue: [],
          onboardingCompletedAt: '2026-04-10T09:00:00.000Z',
        },
      },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  onboardingDashboardLink: {
    summary: 'Get a login link for the Stripe Express Dashboard',
    description:
      'Returns a one-time URL that logs the instructor into the simplified ' +
      'Stripe Express Dashboard where they can see payouts, tax forms, and ' +
      'update bank details. The URL expires shortly after generation — ' +
      'never cache it.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Dashboard link created',
        example: {
          url: 'https://connect.stripe.com/express/Lb...',
        },
      },
      ApiStandardResponses.Unauthorized,
      {
        status: 422,
        description:
          'Instructor has not completed onboarding yet — no Express Dashboard to log in to',
      },
    ],
  } as ApiEndpointOptions,

  // =====================================================================
  // PRODUCTS (Phase 3)
  // =====================================================================

  createProduct: {
    summary: 'Create a product (one-off or subscription)',
    description:
      'Creates a BeeActive Product row and mirrors it to Stripe as a ' +
      'Product + Price. For SUBSCRIPTION types, `interval` and ' +
      '`intervalCount` are required.',
    auth: true,
    responses: [
      { status: 201, description: 'Product created' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  listProducts: {
    summary: 'List my products (paginated)',
    description: "Returns the authenticated instructor's active products.",
    auth: true,
    responses: [
      { status: 200, description: 'Products listed' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  updateProduct: {
    summary: 'Update a product',
    description:
      'Updates name/description/active flag. Amount changes create a new ' +
      'Stripe Price and replace the mirrored stripePriceId (the old Price ' +
      'is archived, not deleted, so historical invoices still resolve).',
    auth: true,
    responses: [
      { status: 200, description: 'Product updated' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  deleteProduct: {
    summary: 'Deactivate a product',
    description:
      'Soft delete — sets is_active=false. The product is hidden from the ' +
      'picker but historical invoices continue to resolve it.',
    auth: true,
    responses: [
      { status: 204, description: 'Product deactivated' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  // =====================================================================
  // INVOICES (Phase 3)
  // =====================================================================

  createInvoice: {
    summary: 'Create a new invoice',
    description:
      'Creates a one-off invoice for a client (registered or external). ' +
      'If `clientUserId` is given, the invoice is linked to a BeeActive user ' +
      '(preferred). If `guestEmail` + `guestName` are given instead, a guest ' +
      'stripe_customer row is created and the invoice can only be paid via ' +
      "Stripe's hosted page (no in-app Checkout).\n\n" +
      'Rate limited to 30 calls/hour per instructor.',
    auth: true,
    responses: [
      { status: 201, description: 'Invoice created' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      {
        status: 422,
        description: 'Instructor has not completed Stripe onboarding',
      },
    ],
  } as ApiEndpointOptions,

  listInvoices: {
    summary: 'List invoices (instructor view, paginated)',
    auth: true,
    responses: [{ status: 200, description: 'Invoices listed' }],
  } as ApiEndpointOptions,

  getInvoice: {
    summary: 'Get invoice details',
    description:
      'Returns the invoice including `hostedInvoiceUrl` and `invoicePdf`. ' +
      'The hosted URL is safe to iframe.',
    auth: true,
    responses: [{ status: 200, description: 'Invoice returned' }],
  } as ApiEndpointOptions,

  sendInvoice: {
    summary: 'Finalize and send an invoice',
    description:
      'Transitions DRAFT → OPEN and triggers Stripe to email the invoice ' +
      'to the client. Idempotent — sending twice is safe.',
    auth: true,
    responses: [{ status: 200, description: 'Invoice sent' }],
  } as ApiEndpointOptions,

  voidInvoice: {
    summary: 'Void an invoice',
    description:
      'Only works for OPEN or UNCOLLECTIBLE invoices. Cannot void a PAID ' +
      'invoice — to reverse a paid invoice, issue a refund instead.',
    auth: true,
    responses: [
      { status: 200, description: 'Invoice voided' },
      {
        status: 400,
        description: 'Cannot void a paid invoice — issue a refund instead',
      },
    ],
  } as ApiEndpointOptions,

  markInvoicePaid: {
    summary: 'Mark invoice paid out of band (cash / bank transfer)',
    description:
      'Records the invoice as paid without going through Stripe Checkout. ' +
      'Sets `paid_out_of_band=true`, transitions the invoice to PAID, and ' +
      'incurs NO Stripe fees. Use this when a client paid by cash or direct ' +
      'bank transfer.',
    auth: true,
    responses: [
      { status: 200, description: 'Invoice marked paid' },
      { status: 409, description: 'Invoice already paid' },
    ],
  } as ApiEndpointOptions,

  // =====================================================================
  // SUBSCRIPTIONS (Phase 4)
  // =====================================================================

  createSubscription: {
    summary: 'Create a subscription for a client',
    auth: true,
    responses: [{ status: 201, description: 'Subscription created' }],
  } as ApiEndpointOptions,

  listSubscriptions: {
    summary: 'List my subscriptions',
    auth: true,
    responses: [{ status: 200, description: 'Subscriptions listed' }],
  } as ApiEndpointOptions,

  cancelSubscription: {
    summary: 'Cancel a subscription',
    description:
      'Default behavior is `cancel_at_period_end = true` — the client ' +
      'keeps access through the end of the current billing period. Pass ' +
      '`immediate=true` to cancel right away (rare).',
    auth: true,
    responses: [{ status: 200, description: 'Subscription cancel scheduled' }],
  } as ApiEndpointOptions,

  // =====================================================================
  // REFUNDS (Phase 5)
  // =====================================================================

  createRefund: {
    summary: 'Refund a payment (full or partial)',
    description:
      'Rate limited to 5 calls/hour per instructor. Refund window is 14 ' +
      'days from the original charge unless overridden by admin.',
    auth: true,
    responses: [
      { status: 201, description: 'Refund issued' },
      { status: 403, description: 'Refund window has expired' },
    ],
  } as ApiEndpointOptions,

  // =====================================================================
  // EARNINGS (Phase 5)
  // =====================================================================

  getEarnings: {
    summary: 'Get my earnings dashboard',
    description:
      'Aggregates from local `payment` and `invoice` tables. Returns ' +
      'balance, month-to-date revenue, top-paying clients, outstanding ' +
      'invoice total, and upcoming payout date.',
    auth: true,
    responses: [{ status: 200, description: 'Earnings returned' }],
  } as ApiEndpointOptions,

  // =====================================================================
  // CLIENT-SIDE (Phase 3/4)
  // =====================================================================

  customerSetupIntent: {
    summary: 'Create a SetupIntent to save a card',
    description:
      'Returns a `client_secret` to use with Stripe Elements on the ' +
      "frontend. Use this to attach a new card to the client's " +
      'stripe_customer without charging it.',
    auth: true,
    responses: [{ status: 200, description: 'SetupIntent created' }],
  } as ApiEndpointOptions,

  customerPortalLink: {
    summary: 'Get a Stripe Customer Portal link',
    description:
      'Returns a one-time URL for the Stripe-hosted Customer Portal where ' +
      'the client can manage cards, view subscriptions, and cancel. URL ' +
      'expires after a few minutes — never cache it.',
    auth: true,
    responses: [{ status: 200, description: 'Portal link created' }],
  } as ApiEndpointOptions,

  listPayments: {
    summary: 'List payment history (instructor view, paginated)',
    auth: true,
    responses: [{ status: 200, description: 'Payments listed' }],
  } as ApiEndpointOptions,

  myInvoices: {
    summary: 'List my invoices (client view)',
    auth: true,
    responses: [{ status: 200, description: 'Invoices listed' }],
  } as ApiEndpointOptions,

  myInvoiceDetail: {
    summary: 'Get invoice details (client view)',
    description:
      'Returns the invoice detail for the authenticated client, including ' +
      '`hostedInvoiceUrl` and `invoicePdf`.',
    auth: true,
    responses: [{ status: 200, description: 'Invoice returned' }],
  } as ApiEndpointOptions,

  mySubscriptions: {
    summary: 'List my subscriptions (client view)',
    auth: true,
    responses: [{ status: 200, description: 'Subscriptions listed' }],
  } as ApiEndpointOptions,

  payInvoice: {
    summary: 'Create a Checkout session to pay an invoice',
    description:
      'Creates a Stripe Checkout session for the invoice and returns the ' +
      'redirect URL. The Romanian EU Consumer Rights Directive waiver ' +
      'checkbox is presented to the client at checkout when ' +
      '`requiresImmediateAccessWaiver=true`.',
    auth: true,
    responses: [
      { status: 200, description: 'Checkout session created' },
      { status: 400, description: 'Invoice already paid' },
    ],
  } as ApiEndpointOptions,
};
