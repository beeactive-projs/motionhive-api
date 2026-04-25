import { escapeHtml } from '../../utils/html.utils';
import {
  baseLayout,
  divider,
  featureItem,
  heading,
  paragraph,
  primaryButton,
  subheading,
} from '../_layouts/base-layout';

/**
 * Fired after the user verifies their email — NOT on sign-up. Drops
 * them into the app with a quick orientation of what they can do.
 */
export function welcomeTemplate(
  firstName: string,
  frontendUrl: string,
): string {
  const safeFirstName = escapeHtml(firstName);
  const content = `
    ${heading(`Welcome, ${safeFirstName}! &#9889;`)}
    ${subheading("You're all set to start your journey towards a healthier and more active lifestyle")}
    ${paragraph("Your MotionHive account is ready. Here's what you can do:")}

    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      ${featureItem('&#127947;', '<strong>Join sessions</strong> — Find and participate in sessions that match your goals and preferences')}
      ${featureItem('&#129309;', '<strong>Connect with professionals</strong> — Get personalized guidance')}
      ${featureItem('&#127942;', '<strong>Organize your own events and sessions</strong> — Create sessions and build your community')}
    </table>

    ${primaryButton('&#127775; Get started', frontendUrl)}
    ${divider()}
    ${paragraph("Need help? Just reply to this email — we're happy to assist.")}
  `;

  return baseLayout(content, `Welcome to MotionHive, ${safeFirstName}!`);
}
