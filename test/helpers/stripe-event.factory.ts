import type { Stripe } from 'stripe-types';

export function makeStripeEvent<T extends Stripe.Event.Type>(
  type: T,
  overrides: Partial<Stripe.Event> = {},
): Stripe.Event {
  return {
    id: `evt_test_${Math.random().toString(36).slice(2, 10)}`,
    object: 'event',
    api_version: '2026-03-25.dahlia',
    created: Math.floor(Date.now() / 1000),
    type,
    livemode: false,
    pending_webhooks: 0,
    request: { id: null, idempotency_key: null },
    data: {
      object: { id: 'acct_test', object: 'account' },
      previous_attributes: null,
    },
    ...overrides,
  } as unknown as Stripe.Event;
}
