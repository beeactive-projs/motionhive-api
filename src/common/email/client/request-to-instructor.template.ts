import { escapeHtml } from '../../utils/html.utils';

/**
 * Notifies an instructor that a user has requested to become their
 * client. The deep link opens the instructor's Clients page with the
 * specific request highlighted so they can accept or decline in one
 * click.
 */
export function clientRequestToInstructorTemplate(params: {
  instructorFirstName: string | null;
  clientName: string;
  reviewLink: string;
  message?: string;
}): string {
  const { instructorFirstName, clientName, reviewLink, message } = params;
  const safeFirst = escapeHtml(instructorFirstName);
  const safeClient = escapeHtml(clientName);
  const safeMessage = escapeHtml(message);
  const greeting = instructorFirstName ? `Hi ${safeFirst},` : 'Hi,';

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <p>${greeting}</p>
      <h2 style="margin: 0 0 12px;">New client request</h2>
      <p><strong>${safeClient}</strong> wants to work with you as a client.</p>
      ${message ? `<p style="padding: 12px; background: #f5f5f5; border-radius: 8px; font-style: italic;">"${safeMessage}"</p>` : ''}
      <p>Log in to accept or decline:</p>
      <a href="${reviewLink}" style="display: inline-block; padding: 12px 24px; background: #f59e0b; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold;">Review request</a>
    </div>
  `;
}
