import { escapeHtml } from '../../utils/html.utils';
import {
  baseLayout,
  COLORS,
  heading,
  paragraph,
  subheading,
} from '../_layouts/base-layout';

/**
 * Fires when an instructor flips a participant's session status
 * (CONFIRMED / CANCELLED / ATTENDED / NO_SHOW). The label is
 * humanized for non-engineers; status names are an internal enum but
 * we still escape as defense-in-depth.
 */
export function participantStatusTemplate(
  participantName: string,
  sessionTitle: string,
  newStatus: string,
  scheduledAt: string,
): string {
  const safeParticipant = escapeHtml(participantName);
  const safeTitle = escapeHtml(sessionTitle);
  const safeScheduled = escapeHtml(scheduledAt);
  const statusLabels: Record<string, string> = {
    CONFIRMED: 'confirmed',
    CANCELLED: 'cancelled',
    ATTENDED: 'marked as attended',
    NO_SHOW: 'marked as no-show',
  };
  const statusLabel = escapeHtml(
    statusLabels[newStatus] || newStatus.toLowerCase(),
  );

  const content = `
    ${heading('Session status update')}
    ${subheading(`Your registration status has changed`)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:#f8fafc;border-radius:8px;padding:20px;border-left:4px solid ${COLORS.accent};">
          <p style="margin:0 0 8px;font-size:16px;font-weight:600;color:${COLORS.textDark};">${safeTitle}</p>
          <p style="margin:0 0 4px;font-size:14px;color:${COLORS.textBody};">Scheduled: ${safeScheduled}</p>
          <p style="margin:0;font-size:14px;color:${COLORS.textBody};">Status: <strong>${statusLabel}</strong></p>
        </td>
      </tr>
    </table>

    ${paragraph(`Hi ${safeParticipant}, your registration for this session has been ${statusLabel} by the instructor.`)}
  `;

  return baseLayout(content, `Your session status has been updated`);
}
