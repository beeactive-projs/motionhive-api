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
 * Public-facing acknowledgement when someone joins the pre-launch
 * waitlist from the marketing site. Keep the tone light — these are
 * cold leads, not active users.
 */
export function waitlistConfirmationTemplate(name?: string): string {
  const greeting = name ? `Hi ${escapeHtml(name)},` : 'Hi there,';

  const content = `
    ${heading("You're on the list! &#127881;")}
    ${subheading('Thanks for your interest in MotionHive')}
    ${paragraph(`${greeting} we're thrilled that you want to be part of the MotionHive community.`)}
    ${paragraph("We're working hard to build a platform that makes fitness more accessible, social, and fun. You'll be among the <strong>first to know</strong> when we launch.")}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
      <tr>
        <td style="background-color:${COLORS.highlightBg};border-radius:8px;padding:16px 20px;border-left:4px solid ${COLORS.accent};">
          <p style="margin:0;font-size:14px;color:${COLORS.highlightStrong};line-height:1.5;">
            &#128640; <strong>What happens next?</strong> We'll send you an invite as soon as early access opens. Stay tuned!
          </p>
        </td>
      </tr>
    </table>

    ${divider()}
    ${paragraph('In the meantime, follow us for updates and sneak peeks.')}
  `;

  return baseLayout(
    content,
    "You're on the MotionHive waitlist!",
    "You're receiving this because you signed up for the MotionHive waitlist.",
  );
}
