/**
 * Public surface of the email-templates suite. Importers (currently
 * `EmailService`) reach for templates via this barrel rather than
 * deep paths so renames inside the folder stay invisible to
 * consumers.
 *
 * Layout helpers live in `_layouts/base-layout.ts` and are reserved
 * for new template authors — services should never import them.
 */

export {
  emailVerificationTemplate,
  emailVerificationTemplateText,
} from './auth/email-verification.template';
export { welcomeTemplate, welcomeTemplateText } from './auth/welcome.template';
export {
  passwordResetTemplate,
  passwordResetTemplateText,
} from './auth/password-reset.template';
export {
  passwordChangedTemplate,
  passwordChangedTemplateText,
} from './auth/password-changed.template';

export {
  accountDeletionCodeTemplate,
  accountDeletionCodeTemplateText,
} from './account/deletion-code.template';
export {
  accountDeletionScheduledTemplate,
  accountDeletionScheduledTemplateText,
} from './account/deletion-scheduled.template';
export {
  accountDeletionCancelledTemplate,
  accountDeletionCancelledTemplateText,
} from './account/deletion-cancelled.template';
export {
  accountDeletionCompletedTemplate,
  accountDeletionCompletedTemplateText,
} from './account/deletion-completed.template';

export {
  invitationTemplate,
  invitationTemplateText,
} from './group/invitation.template';
export {
  invitationAcceptedTemplate,
  invitationAcceptedTemplateText,
} from './group/invitation-accepted.template';
export {
  groupMemberLeftTemplate,
  groupMemberLeftTemplateText,
} from './group/member-left.template';
export {
  groupMemberRemovedTemplate,
  groupMemberRemovedTemplateText,
} from './group/member-removed.template';
export {
  groupJoinRequestReceivedTemplate,
  groupJoinRequestReceivedTemplateText,
} from './group/join-request-received.template';
export {
  groupOwnershipTransferredTemplate,
  groupOwnershipTransferredTemplateText,
} from './group/ownership-transferred.template';
export {
  groupJoinRequestDecidedTemplate,
  groupJoinRequestDecidedTemplateText,
} from './group/join-request-decided.template';
export {
  invitationDeclinedTemplate,
  invitationDeclinedTemplateText,
} from './group/invitation-declined.template';
export {
  groupRoleChangedTemplate,
  groupRoleChangedTemplateText,
} from './group/role-changed.template';

export {
  feedbackConfirmationTemplate,
  feedbackConfirmationTemplateText,
} from './feedback/confirmation.template';
export {
  waitlistConfirmationTemplate,
  waitlistConfirmationTemplateText,
} from './waitlist/confirmation.template';
export {
  invoiceSendTemplate,
  invoiceSendTemplateText,
} from './invoice/send.template';
export {
  subscriptionSetupTemplate,
  subscriptionSetupTemplateText,
} from './subscription/setup.template';

export {
  clientInvitationNewUserTemplate,
  clientInvitationNewUserTemplateText,
} from './client/invitation-new-user.template';
export {
  clientInvitationExistingUserTemplate,
  clientInvitationExistingUserTemplateText,
} from './client/invitation-existing-user.template';
export {
  clientInvitationImportedTemplate,
  clientInvitationImportedTemplateText,
} from './client/invitation-imported.template';
export {
  clientRequestToInstructorTemplate,
  clientRequestToInstructorTemplateText,
} from './client/request-to-instructor.template';
export {
  clientRequestAcceptedTemplate,
  clientRequestAcceptedTemplateText,
} from './client/request-accepted.template';
export {
  clientRequestDeclinedTemplate,
  clientRequestDeclinedTemplateText,
} from './client/request-declined.template';
export {
  collaborationEndedTemplate,
  collaborationEndedTemplateText,
} from './client/collaboration-ended.template';

export {
  genericNotificationTemplate,
  genericNotificationTemplateText,
} from './notification/generic.template';

export {
  friendInviteTemplate,
  friendInviteTemplateText,
} from './social/friend-invite.template';
export {
  instructorSuggestionTemplate,
  instructorSuggestionTemplateText,
} from './social/instructor-suggestion.template';
