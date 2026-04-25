import { escapeHtml } from '../../utils/html.utils';
import {
  baseLayout,
  divider,
  heading,
  paragraph,
  subheading,
} from '../_layouts/base-layout';

/**
 * Sent to every confirmed participant when an instructor cancels a
 * session. Worded with a small apology because cancellations are a
 * trust event — keep it short and don't pile on offers.
 */
export function sessionCancelledTemplate(
  participantName: string,
  sessionTitle: string,
  instructorName: string,
  scheduledAt: string,
): string {
  const safeParticipant = escapeHtml(participantName);
  const safeTitle = escapeHtml(sessionTitle);
  const safeInstructor = escapeHtml(instructorName);
  const safeScheduled = escapeHtml(scheduledAt);
  const content = `
    ${heading('Session cancelled')}
    ${subheading(`A session you were registered for has been cancelled`)}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:#fef2f2;border-radius:8px;padding:20px;border-left:4px solid #ef4444;">
          <p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#991b1b;">${safeTitle}</p>
          <p style="margin:0 0 4px;font-size:14px;color:#7f1d1d;">Instructor: ${safeInstructor}</p>
          <p style="margin:0;font-size:14px;color:#7f1d1d;">Scheduled: ${safeScheduled}</p>
        </td>
      </tr>
    </table>

    ${paragraph(`Hi ${safeParticipant}, the instructor has cancelled this session. We apologize for any inconvenience.`)}
    ${divider()}
    ${paragraph('You can browse other available sessions on the platform.')}
  `;

  return baseLayout(content, `Session "${safeTitle}" has been cancelled`);
}
