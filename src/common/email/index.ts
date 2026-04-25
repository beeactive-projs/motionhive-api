/**
 * Public surface of the email-templates suite. Importers (currently
 * `EmailService`) reach for templates via this barrel rather than
 * deep paths so renames inside the folder stay invisible to
 * consumers.
 *
 * Layout helpers live in `_layouts/base-layout.ts` and are reserved
 * for new template authors — services should never import them.
 */

export { emailVerificationTemplate } from './auth/email-verification.template';
export { welcomeTemplate } from './auth/welcome.template';
export { passwordResetTemplate } from './auth/password-reset.template';

export { invitationTemplate } from './group/invitation.template';
export { invitationAcceptedTemplate } from './group/invitation-accepted.template';

export { sessionCancelledTemplate } from './session/cancelled.template';
export { participantStatusTemplate } from './session/participant-status.template';
export { sessionReminderTemplate } from './session/reminder.template';

export { feedbackConfirmationTemplate } from './feedback/confirmation.template';
export { waitlistConfirmationTemplate } from './waitlist/confirmation.template';
export { invoiceSendTemplate } from './invoice/send.template';
export { subscriptionSetupTemplate } from './subscription/setup.template';

export { clientInvitationNewUserTemplate } from './client/invitation-new-user.template';
export { clientInvitationExistingUserTemplate } from './client/invitation-existing-user.template';
export { clientRequestToInstructorTemplate } from './client/request-to-instructor.template';
export { clientRequestAcceptedTemplate } from './client/request-accepted.template';
export { clientRequestDeclinedTemplate } from './client/request-declined.template';
export { collaborationEndedTemplate } from './client/collaboration-ended.template';
