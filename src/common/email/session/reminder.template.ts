import { escapeHtml } from '../../utils/html.utils';
import {
  baseLayout,
  COLORS,
  featureItem,
  heading,
  paragraph,
  subheading,
} from '../_layouts/base-layout';

/**
 * Pre-session reminder. Currently unused; will be wired up by the
 * pending jobs module (see `project_jobs_module_pending.md`). Kept
 * here so the template ships with the rest of the suite and a quick
 * visual review is possible without re-deriving the design.
 */
export function sessionReminderTemplate(
  participantName: string,
  sessionTitle: string,
  instructorName: string,
  scheduledAt: string,
  location: string,
): string {
  // TODO [jobs-module]: emit this template from a scheduled reminder
  // worker N hours before `session.scheduled_at`.
  const safeParticipant = escapeHtml(participantName);
  const safeTitle = escapeHtml(sessionTitle);
  const safeInstructor = escapeHtml(instructorName);
  const safeScheduled = escapeHtml(scheduledAt);
  const safeLocation = escapeHtml(location);
  const content = `
    ${heading('Session reminder')}
    ${subheading("Don't forget — your session is coming up!")}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:#f0fdf4;border-radius:8px;padding:20px;border-left:4px solid ${COLORS.green};">
          <p style="margin:0 0 8px;font-size:18px;font-weight:600;color:#166534;">${safeTitle}</p>
          <table role="presentation" cellpadding="0" cellspacing="0">
            ${featureItem('&#128197;', `<strong>When:</strong> ${safeScheduled}`)}
            ${featureItem('&#128205;', `<strong>Where:</strong> ${safeLocation}`)}
            ${featureItem('&#128100;', `<strong>Instructor:</strong> ${safeInstructor}`)}
          </table>
        </td>
      </tr>
    </table>

    ${paragraph(`Hi ${safeParticipant}, get ready for your upcoming session!`)}
  `;

  return baseLayout(content, `Reminder: "${safeTitle}" is coming up`);
}
