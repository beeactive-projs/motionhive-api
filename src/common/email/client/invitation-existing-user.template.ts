import { escapeHtml } from '../../utils/html.utils';

/**
 * Client invitation to a recipient who already has a MotionHive
 * account. The CTA deep-links into the in-app coaches tab with the
 * specific request open, so a single click takes them to accept or
 * decline.
 */
export function clientInvitationExistingUserTemplate(params: {
  recipientFirstName: string | null;
  instructorName: string;
  acceptLink: string;
  message?: string;
}): string {
  const { recipientFirstName, instructorName, acceptLink, message } = params;
  const safeFirst = escapeHtml(recipientFirstName);
  const safeInstructor = escapeHtml(instructorName);
  const safeMessage = escapeHtml(message);
  const greeting = recipientFirstName ? `Hi ${safeFirst},` : 'Hi,';

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <p>${greeting}</p>
      <h2 style="margin: 0 0 12px;">${safeInstructor} sent you a client request</h2>
      <p><strong>${safeInstructor}</strong> wants to add you as a client on MotionHive. Accept to start coordinating sessions, memberships and invoices together.</p>
      ${message ? `<p style="padding: 12px; background: #f5f5f5; border-radius: 8px; font-style: italic;">"${safeMessage}"</p>` : ''}
      <p>Log in to accept or decline:</p>
      <a href="${acceptLink}" style="display: inline-block; padding: 12px 24px; background: #f59e0b; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold;">Review request</a>
      <p style="margin-top: 24px; color: #666; font-size: 14px;">If you weren't expecting this, you can safely ignore the email or decline from your account.</p>
    </div>
  `;
}
