import { escapeHtml } from '../../utils/html.utils';

/**
 * Tells the request sender their client request was declined.
 * Intentionally brief and non-punishing — soft-language is a product
 * decision, not an oversight.
 */
export function clientRequestDeclinedTemplate(params: {
  recipientFirstName: string | null;
  responderName: string;
}): string {
  const { recipientFirstName, responderName } = params;
  const safeFirst = escapeHtml(recipientFirstName);
  const safeResponder = escapeHtml(responderName);
  const greeting = recipientFirstName ? `Hi ${safeFirst},` : 'Hi,';

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <p>${greeting}</p>
      <p><strong>${safeResponder}</strong> isn't able to take on your request at this time.</p>
      <p style="color: #666; font-size: 14px;">You can explore other options on MotionHive whenever you're ready.</p>
    </div>
  `;
}
