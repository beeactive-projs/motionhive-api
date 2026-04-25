import { escapeHtml } from '../../utils/html.utils';
import {
  baseLayout,
  COLORS,
  divider,
  expiryNote,
  heading,
  paragraph,
  primaryButton,
  securityNote,
  subheading,
} from '../_layouts/base-layout';

/**
 * Group invitation — the inviter is sending someone (registered or
 * not) a link to join their group. The accept link carries a single-
 * use token; expires in 7 days.
 */
export function invitationTemplate(
  inviterName: string,
  groupName: string,
  acceptLink: string,
  message?: string,
): string {
  const safeInviter = escapeHtml(inviterName);
  const safeGroup = escapeHtml(groupName);
  const safeMessage = escapeHtml(message);
  const messageBlock = message
    ? `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 24px;">
        <tr>
          <td style="background-color:#f8fafc;border-radius:8px;padding:16px 20px;border-left:4px solid ${COLORS.accent};">
            <p style="margin:0 0 4px;font-size:12px;color:${COLORS.textMuted};text-transform:uppercase;letter-spacing:0.5px;">Personal message</p>
            <p style="margin:0;font-size:15px;color:${COLORS.textBody};font-style:italic;line-height:1.5;">"${safeMessage}"</p>
          </td>
        </tr>
      </table>`
    : '';

  const content = `
    ${heading("You're invited!")}
    ${subheading(`${safeInviter} wants you to join their team`)}
    ${paragraph(`<strong>${safeInviter}</strong> has invited you to join <strong>${safeGroup}</strong> on MotionHive — a fitness platform for instructors and clients.`)}
    ${messageBlock}
    ${primaryButton('&#129309; Accept invitation', acceptLink)}
    ${divider()}
    <p style="margin:0 0 16px;font-size:14px;color:${COLORS.textBody};line-height:1.5;">
      By accepting, you'll be added as a member of <strong>${safeGroup}</strong> and can start joining training sessions.
    </p>
    ${expiryNote('This invitation expires in <strong>7 days</strong>.')}
    ${securityNote("If you don't know the person who sent this, you can safely ignore this email.")}
  `;

  return baseLayout(content, `${safeInviter} invited you to join ${safeGroup}`);
}
