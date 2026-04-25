import { escapeHtml } from '../../utils/html.utils';
import {
  baseLayout,
  divider,
  heading,
  paragraph,
  subheading,
} from '../_layouts/base-layout';

/**
 * Sent to BOTH parties when a coaching collaboration ends — either
 * the client leaves the trainer or the trainer archives the client.
 * The `endedBy` flag picks the right copy ("you ended" vs "they
 * ended"). Active subscriptions are NOT auto-cancelled by ending the
 * collaboration; we mention that to set the right expectation.
 */
export function collaborationEndedTemplate(params: {
  recipientName: string | null;
  otherPartyName: string;
  endedBy: 'self' | 'other';
  recipientRole: 'instructor' | 'client';
}): string {
  const { recipientName, otherPartyName, endedBy, recipientRole } = params;
  const safeOther = escapeHtml(otherPartyName);
  const greeting = recipientName
    ? `Hi ${escapeHtml(recipientName)},`
    : 'Hi there,';

  const headlineText =
    endedBy === 'self'
      ? `You ended your collaboration with ${safeOther}`
      : `${safeOther} ended your collaboration`;

  const bodyText =
    endedBy === 'self'
      ? `You ended your coaching collaboration with <strong>${safeOther}</strong> on MotionHive. They no longer appear in your ${recipientRole === 'instructor' ? 'client list' : 'coaches list'}, and they can no longer ${recipientRole === 'instructor' ? 'see your private sessions' : 'invite you to their sessions'}.`
      : `<strong>${safeOther}</strong> ended your coaching collaboration on MotionHive. They no longer appear in your ${recipientRole === 'instructor' ? 'client list' : 'coaches list'}.`;

  const subscriptionNote =
    recipientRole === 'client'
      ? paragraph(
          'If you have an active membership with this trainer, it remains active until you cancel it from your billing page.',
        )
      : paragraph(
          "Any active memberships this client has with you remain in place until they (or you) cancel them — ending the collaboration doesn't auto-cancel subscriptions.",
        );

  const content = `
    ${heading('Collaboration ended')}
    ${subheading(headlineText)}
    ${paragraph(`${greeting} ${bodyText}`)}
    ${subscriptionNote}
    ${divider()}
    ${paragraph('You can always reconnect later by sending a new invitation.')}
  `;

  return baseLayout(
    content,
    headlineText,
    "You're receiving this because a coaching collaboration on your MotionHive account changed status.",
  );
}
