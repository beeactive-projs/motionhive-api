import { escapeHtml } from '../../utils/html.utils';
import {
  baseLayout,
  COLORS,
  divider,
  heading,
  paragraph,
  primaryButton,
  subheading,
} from '../_layouts/base-layout';

/**
 * Invoice send email (override-email path).
 *
 * Used when the instructor chooses to email the invoice to an address
 * that differs from the customer's on-file email. Stripe's native
 * `sendInvoice` endpoint always targets the customer's saved email,
 * so for a one-off override we take over delivery from our side and
 * link to the hosted invoice page Stripe already generated.
 */
export function invoiceSendTemplate(params: {
  instructorName: string;
  amountLabel: string;
  dueDateLabel: string | null;
  invoiceNumber: string | null;
  hostedInvoiceUrl: string;
  invoicePdfUrl: string | null;
  recipientName?: string | null;
}): string {
  const {
    instructorName,
    amountLabel,
    dueDateLabel,
    invoiceNumber,
    hostedInvoiceUrl,
    invoicePdfUrl,
    recipientName,
  } = params;

  const safeInstructor = escapeHtml(instructorName);
  const safeAmount = escapeHtml(amountLabel);
  const safeDue = escapeHtml(dueDateLabel);
  const safeNumber = escapeHtml(invoiceNumber);
  const greeting = recipientName
    ? `Hi ${escapeHtml(recipientName)},`
    : 'Hi there,';
  const numberLine = invoiceNumber ? ` (${safeNumber})` : '';

  const content = `
    ${heading('You have a new invoice')}
    ${subheading(`${safeInstructor} sent you an invoice on MotionHive`)}
    ${paragraph(`${greeting} ${safeInstructor} has issued you invoice${numberLine} for <strong>${safeAmount}</strong>${dueDateLabel ? `, due <strong>${safeDue}</strong>` : ''}.`)}

    ${primaryButton('View &amp; pay invoice', hostedInvoiceUrl)}

    ${
      invoicePdfUrl
        ? `<p style="margin:0 0 16px;font-size:13px;color:${COLORS.textMuted};line-height:1.5;text-align:center;">
             Prefer a copy for your records?
             <a href="${invoicePdfUrl}" style="color:${COLORS.accent};text-decoration:none;font-weight:600;">Download PDF</a>
           </p>`
        : ''
    }

    ${divider()}
    ${paragraph('Payment is handled securely by Stripe.')}
  `;

  return baseLayout(
    content,
    `${safeInstructor} sent you an invoice for ${safeAmount}`,
    "You're receiving this because an invoice was sent to this address on MotionHive.",
  );
}
