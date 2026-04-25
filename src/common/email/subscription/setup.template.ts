import { escapeHtml } from '../../utils/html.utils';
import {
  baseLayout,
  divider,
  heading,
  paragraph,
  primaryButton,
  subheading,
} from '../_layouts/base-layout';

/**
 * Sent to a client when their trainer sets up a recurring membership.
 *
 * Always-confirm policy: every new subscription requires the client
 * to explicitly confirm — even if they have a card on file from a
 * prior one. The link points at the first invoice's Stripe-hosted
 * page, which shows the plan name + amount + cycle and lets them
 * confirm with a saved card or a new one. Once they pay, Stripe
 * activates the subscription. See SECURITY_NOTES.md for the
 * rationale.
 */
export function subscriptionSetupTemplate(params: {
  instructorName: string;
  planName: string;
  amountLabel: string;
  cycleLabel: string | null;
  /** Kept named `setupUrl` for back-compat — this is the confirmation URL. */
  setupUrl: string;
  recipientName?: string | null;
}): string {
  const {
    instructorName,
    planName,
    amountLabel,
    cycleLabel,
    setupUrl,
    recipientName,
  } = params;

  const safeInstructor = escapeHtml(instructorName);
  const safePlan = escapeHtml(planName);
  const safeAmount = escapeHtml(amountLabel);
  const safeCycle = escapeHtml(cycleLabel);
  const greeting = recipientName
    ? `Hi ${escapeHtml(recipientName)},`
    : 'Hi there,';
  const cyclePhrase = cycleLabel ? ` ${safeCycle}` : '';

  const content = `
    ${heading('Confirm your membership')}
    ${subheading(`${safeInstructor} set up a recurring plan for you`)}
    ${paragraph(`${greeting} ${safeInstructor} created a <strong>${safePlan}</strong> membership for you on MotionHive.`)}
    ${paragraph(`<strong>${safeAmount}</strong>${cyclePhrase ? `, billed ${cyclePhrase}` : ''}.`)}
    ${paragraph("Click below to confirm and start your membership. You'll be able to use a saved card or enter a new one — and you can cancel any time from your account.")}

    ${primaryButton('Confirm and start membership', setupUrl)}

    ${divider()}
    ${paragraph("If you weren't expecting this, you can ignore this email — nothing is charged until you confirm. Payment is handled securely by Stripe.")}
  `;

  return baseLayout(
    content,
    `${safeInstructor} set up a ${safePlan} membership — confirm to start`,
    "You're receiving this because a trainer set up a membership for this address on MotionHive. Nothing is charged until you confirm.",
  );
}
