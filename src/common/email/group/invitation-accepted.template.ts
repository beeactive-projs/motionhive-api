import { escapeHtml } from '../../utils/html.utils';
import {
  baseLayout,
  divider,
  heading,
  paragraph,
  subheading,
} from '../_layouts/base-layout';

/**
 * Sent to the inviter when a recipient accepts a group invitation.
 * Pure notification — no CTA needed, the inviter can open the app
 * to see the new member at their leisure.
 */
export function invitationAcceptedTemplate(
  inviterName: string,
  accepterName: string,
  groupName: string,
): string {
  const safeInviter = escapeHtml(inviterName);
  const safeAccepter = escapeHtml(accepterName);
  const safeGroup = escapeHtml(groupName);
  const content = `
    ${heading('Invitation accepted!')}
    ${subheading(`Great news — someone joined your group`)}
    ${paragraph(`Hi ${safeInviter}, <strong>${safeAccepter}</strong> has accepted your invitation and joined <strong>${safeGroup}</strong>.`)}
    ${divider()}
    ${paragraph('You can view your group members in the MotionHive app.')}
  `;

  return baseLayout(
    content,
    `${safeAccepter} accepted your invitation to ${safeGroup}`,
  );
}
