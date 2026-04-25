import { escapeHtml } from '../../utils/html.utils';

/**
 * Tells the request sender their client request was accepted.
 * Symmetrical to `clientRequestDeclinedTemplate` — the responder name
 * is the party who accepted; the recipient is the original sender.
 */
export function clientRequestAcceptedTemplate(params: {
  recipientFirstName: string | null;
  responderName: string;
  appLink: string;
}): string {
  const { recipientFirstName, responderName, appLink } = params;
  const safeFirst = escapeHtml(recipientFirstName);
  const safeResponder = escapeHtml(responderName);
  const greeting = recipientFirstName ? `Hi ${safeFirst},` : 'Hi,';

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <p>${greeting}</p>
      <h2 style="margin: 0 0 12px;">Request accepted</h2>
      <p><strong>${safeResponder}</strong> accepted your request. You can now coordinate sessions, memberships and invoices together.</p>
      <a href="${appLink}" style="display: inline-block; padding: 12px 24px; background: #f59e0b; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold;">Open MotionHive</a>
    </div>
  `;
}
