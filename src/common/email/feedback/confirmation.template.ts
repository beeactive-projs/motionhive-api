import { escapeHtml } from '../../utils/html.utils';
import {
  baseLayout,
  COLORS,
  divider,
  heading,
  paragraph,
  subheading,
} from '../_layouts/base-layout';

/**
 * Acknowledgement of a feedback submission. Sent only to the address
 * the submitter typed (NOT looked up from a `userId` — that vector
 * was removed for security; see `FeedbackService.create`).
 */
export function feedbackConfirmationTemplate(
  type: string,
  title: string,
  name?: string,
): string {
  const safeTitle = escapeHtml(title);
  const safeType = escapeHtml(type);
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi there,';
  const typeLabel = escapeHtml(type.charAt(0).toUpperCase() + type.slice(1));

  const content = `
    ${heading('Feedback received &#9989;')}
    ${subheading('We appreciate you taking the time to write to us')}
    ${paragraph(`${greeting} thank you for your ${safeType}. Every piece of feedback helps us build a better platform.`)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 24px;">
      <tr>
        <td style="background-color:${COLORS.cardBg};border:1px solid ${COLORS.cardBorder};border-radius:8px;padding:16px 20px;">
          <p style="margin:0 0 4px;font-size:12px;color:${COLORS.textMuted};text-transform:uppercase;letter-spacing:0.5px;">Your ${typeLabel}</p>
          <p style="margin:0;font-size:15px;font-weight:600;color:${COLORS.textDark};line-height:1.4;">${safeTitle}</p>
        </td>
      </tr>
    </table>

    ${paragraph("Our team reviews every submission. While we can't respond to each one individually, your input directly shapes what we build next.")}
    ${divider()}
    ${paragraph('Thanks for helping us improve MotionHive!')}
  `;

  return baseLayout(
    content,
    'Thanks for your feedback!',
    "You're receiving this because you submitted feedback on MotionHive.",
  );
}
