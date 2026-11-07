import * as templates from '../../src/common/email';
import { Locale, day, translate } from '../../src/common/i18n';
import {
  NotificationMessage,
  renderNotificationMessage,
} from '../../src/modules/notification/notification-message';

/**
 * Every transactional email the product sends, rendered with realistic
 * values.
 *
 * Each entry is one wording a reader can get: a template usually has a
 * typical case plus the cases where a name or a message is missing, a
 * flag picks different copy, or a count changes the grammar. The spec
 * (`src/common/email/email-templates.spec.ts`) runs all of them in
 * every language, and `scripts/send-email-previews.ts` sends the same
 * list to a real inbox.
 *
 * Subjects are built exactly as `EmailService` builds them (same
 * catalog key, same params), and links have the shape the service
 * gives them, so a sample reads like the real send.
 *
 * Values are fixed: no `new Date()`, no randomness. The same sample
 * renders the same text on every run.
 */
export type EmailAudience =
  | 'client'
  | 'instructor'
  | 'group owner'
  | 'group member'
  | 'new user'
  | 'visitor';

type Templates = typeof templates;

/**
 * The HTML template functions of `src/common/email`. Each one has a
 * plain-text twin named `<name>Text` that takes the same arguments.
 */
export type EmailTemplateName = {
  [K in keyof Templates]: K extends `${string}TemplateText`
    ? never
    : K extends `${string}Template`
      ? K
      : never;
}[keyof Templates];

export interface EmailSample {
  /** `<domain>/<template>` plus a variant suffix when there are several, e.g. `group/join-request-decided:approved`. */
  name: string;
  /**
   * The template function that renders it. Not a label: `html` and
   * `text` call this function (and its `…Text` twin), so the coverage
   * check in the spec cannot be satisfied by a sample that renders
   * something else.
   */
  templateName: EmailTemplateName;
  /** Who receives it: 'client' | 'instructor' | 'group owner' | 'group member' | 'new user' | 'visitor'. */
  audience: EmailAudience;
  /** What makes this wording different from the template's typical one ('typical', 'no name', 'with message', …). */
  variant: string;
  subject: (locale: Locale) => string;
  html: (locale: Locale) => string;
  text: (locale: Locale) => string;
}

interface SampleSpec<K extends EmailTemplateName> {
  name: string;
  audience: EmailAudience;
  variant: string;
  subject: (locale: Locale) => string;
  /** The arguments both the HTML template and its text twin are called with. */
  args: (locale: Locale) => Parameters<Templates[K]>;
}

type Render = (...args: unknown[]) => string;

function sample<K extends EmailTemplateName>(
  templateName: K,
  spec: SampleSpec<K>,
): EmailSample {
  const render = (fn: string, locale: Locale): string =>
    (templates[fn as keyof Templates] as Render)(...spec.args(locale));
  return {
    name: spec.name,
    templateName,
    audience: spec.audience,
    variant: spec.variant,
    subject: spec.subject,
    html: (locale) => render(templateName, locale),
    text: (locale) => render(`${templateName}Text`, locale),
  };
}

// ── Sample values (Romanian on purpose, the same in both languages) ──

/** `FRONTEND_URL` in production. */
const APP = 'https://app.motionhive.fit';

/** The client / group member. */
const ANA = { first: 'Ana', full: 'Ana Pop' };
/** The instructor / group owner. */
const DAN = { first: 'Dan', full: 'Dan Ionescu' };

const GROUP = { id: 'group-1', name: 'Alergătorii de dimineață' };
const GROUP_LINK = `${APP}/groups/${GROUP.id}`;
const MESSAGE = 'Hai să ne antrenăm împreună!';
const REQUEST_ID = 'req-1';

type InvoiceArgs = Omit<
  Parameters<Templates['invoiceSendTemplate']>[0],
  'locale'
>;
type SubscriptionArgs = Omit<
  Parameters<Templates['subscriptionSetupTemplate']>[0],
  'locale'
>;

const INVOICE: InvoiceArgs = {
  instructorName: DAN.full,
  amountCents: 25000,
  currency: 'ron',
  dueDate: '2026-06-30',
  invoiceNumber: 'INV-0042',
  hostedInvoiceUrl: 'https://invoice.stripe.com/i/acct_sample/inv_0042',
  invoicePdfUrl: 'https://invoice.stripe.com/i/acct_sample/inv_0042/pdf',
  // `InvoiceService` has no name for an override address, so the
  // typical invoice email greets nobody by name.
  recipientName: null,
};

const SUBSCRIPTION: SubscriptionArgs = {
  instructorName: DAN.full,
  planName: 'Abonament lunar',
  amountCents: 25000,
  currency: 'ron',
  interval: 'month',
  intervalCount: 1,
  setupUrl: 'https://invoice.stripe.com/i/acct_sample/sub_0042',
  recipientName: ANA.first,
};

const PASSWORD_CHANGED = {
  firstName: ANA.first,
  changedAt: new Date('2026-10-01T15:30:00Z'),
  timeZone: 'Europe/Bucharest',
  resetLink: `${APP}/auth/reset-password`,
};

// ── auth ──

const auth: EmailSample[] = [
  sample('emailVerificationTemplate', {
    name: 'auth/email-verification',
    audience: 'new user',
    variant: 'typical',
    subject: (locale) => translate(locale, 'email.auth.verification.subject'),
    args: (locale) => [
      `${APP}/auth/verify-email?token=sample-verify-token`,
      locale,
    ],
  }),
  sample('welcomeTemplate', {
    name: 'auth/welcome',
    audience: 'new user',
    variant: 'typical',
    subject: (locale) => translate(locale, 'email.auth.welcome.subject'),
    args: (locale) => [ANA.first, APP, locale],
  }),
  // Any account holder can get the two password emails; they are filed
  // under 'client' as the most common reader.
  sample('passwordResetTemplate', {
    name: 'auth/password-reset',
    audience: 'client',
    variant: 'typical',
    subject: (locale) => translate(locale, 'email.auth.passwordReset.subject'),
    args: (locale) => [
      `${APP}/auth/new-password?token=sample-reset-token`,
      locale,
    ],
  }),
  sample('passwordChangedTemplate', {
    name: 'auth/password-changed',
    audience: 'client',
    variant: 'typical',
    subject: (locale) =>
      translate(locale, 'email.auth.passwordChanged.subject'),
    args: (locale) => [{ ...PASSWORD_CHANGED, locale }],
  }),
  sample('passwordChangedTemplate', {
    name: 'auth/password-changed:no-name',
    audience: 'client',
    variant: 'no name',
    subject: (locale) =>
      translate(locale, 'email.auth.passwordChanged.subject'),
    args: (locale) => [{ ...PASSWORD_CHANGED, firstName: null, locale }],
  }),
];

// ── account ──

const DELETION_SCHEDULED_FOR = new Date('2026-11-14T03:00:00Z');

const account: EmailSample[] = [
  sample('accountDeletionCodeTemplate', {
    name: 'account/deletion-code',
    audience: 'client',
    variant: 'typical',
    subject: (locale) =>
      translate(locale, 'email.account.deletionCode.subject'),
    args: (locale) => [
      {
        firstName: ANA.first,
        code: '482913',
        changePasswordLink: `${APP}/auth/reset-password`,
        locale,
      },
    ],
  }),
  sample('accountDeletionCodeTemplate', {
    name: 'account/deletion-code:no-name',
    audience: 'client',
    variant: 'no name',
    subject: (locale) =>
      translate(locale, 'email.account.deletionCode.subject'),
    args: (locale) => [
      {
        firstName: null,
        code: '482913',
        changePasswordLink: `${APP}/auth/reset-password`,
        locale,
      },
    ],
  }),
  sample('accountDeletionScheduledTemplate', {
    name: 'account/deletion-scheduled',
    audience: 'client',
    variant: 'typical',
    subject: (locale) =>
      translate(locale, 'email.account.deletionScheduled.subject', {
        date: day(DELETION_SCHEDULED_FOR),
      }),
    args: (locale) => [
      {
        firstName: ANA.first,
        scheduledFor: DELETION_SCHEDULED_FOR,
        signInLink: `${APP}/auth/login`,
        locale,
      },
    ],
  }),
  sample('accountDeletionCancelledTemplate', {
    name: 'account/deletion-cancelled',
    audience: 'client',
    variant: 'typical',
    subject: (locale) =>
      translate(locale, 'email.account.deletionCancelled.subject'),
    args: (locale) => [
      {
        firstName: ANA.first,
        changePasswordLink: `${APP}/auth/reset-password`,
        locale,
      },
    ],
  }),
  sample('accountDeletionCompletedTemplate', {
    name: 'account/deletion-completed',
    audience: 'client',
    variant: 'typical',
    subject: (locale) =>
      translate(locale, 'email.account.deletionCompleted.subject'),
    args: (locale) => [{ firstName: ANA.first, locale }],
  }),
];

// ── group ──

function groupInvitation(
  name: string,
  variant: string,
  inviterName: string | null,
  message: string | undefined,
): EmailSample {
  return sample('invitationTemplate', {
    name,
    // Sent to an email address: the reader may not have an account yet.
    audience: 'new user',
    variant,
    subject: (locale) =>
      translate(locale, 'email.group.invitation.subject', {
        group: GROUP.name,
      }),
    args: (locale) => [
      inviterName,
      GROUP.name,
      `${APP}/join/sample-invitation-token`,
      message,
      locale,
    ],
  });
}

function groupInvitationAccepted(
  name: string,
  variant: string,
  inviterFirstName: string | null,
  accepterName: string | null,
  groupName: string | null,
): EmailSample {
  return sample('invitationAcceptedTemplate', {
    name,
    audience: 'group owner',
    variant,
    subject: (locale) =>
      translate(locale, 'email.group.invitationAccepted.subject', {
        name: accepterName || null,
        group: groupName || null,
      }),
    args: (locale) => [inviterFirstName, accepterName, groupName, APP, locale],
  });
}

function groupInvitationDeclined(
  name: string,
  variant: string,
  inviterName: string | null,
  declinerName: string | null,
): EmailSample {
  return sample('invitationDeclinedTemplate', {
    name,
    audience: 'group owner',
    variant,
    subject: (locale) =>
      translate(locale, 'email.group.invitationDeclined.subject', {
        name: declinerName || null,
        group: GROUP.name,
      }),
    args: (locale) => [inviterName, declinerName, GROUP.name, locale],
  });
}

function groupMemberLeft(
  name: string,
  variant: string,
  ownerFirstName: string | null,
  memberName: string | null,
): EmailSample {
  return sample('groupMemberLeftTemplate', {
    name,
    audience: 'group owner',
    variant,
    subject: (locale) =>
      translate(locale, 'email.group.memberLeft.subject', {
        name: memberName || null,
        group: GROUP.name,
      }),
    args: (locale) => [
      {
        ownerFirstName,
        memberName,
        groupName: GROUP.name,
        groupLink: GROUP_LINK,
        locale,
      },
    ],
  });
}

function groupMemberRemoved(
  name: string,
  variant: string,
  memberFirstName: string | null,
): EmailSample {
  return sample('groupMemberRemovedTemplate', {
    name,
    audience: 'group member',
    variant,
    subject: (locale) =>
      translate(locale, 'email.group.memberRemoved.subject', {
        group: GROUP.name,
      }),
    args: (locale) => [
      {
        memberFirstName,
        groupName: GROUP.name,
        groupsListLink: `${APP}/groups`,
        locale,
      },
    ],
  });
}

function groupJoinRequestReceived(
  name: string,
  variant: string,
  ownerFirstName: string | null,
  requesterName: string | null,
  message: string | undefined,
): EmailSample {
  return sample('groupJoinRequestReceivedTemplate', {
    name,
    audience: 'group owner',
    variant,
    subject: (locale) =>
      translate(locale, 'email.group.joinRequestReceived.subject', {
        name: requesterName || null,
        group: GROUP.name,
      }),
    args: (locale) => [
      {
        ownerFirstName,
        requesterName,
        groupName: GROUP.name,
        reviewLink: `${GROUP_LINK}/members?requestId=${REQUEST_ID}`,
        message,
        locale,
      },
    ],
  });
}

function groupOwnershipTransferred(
  name: string,
  variant: string,
  direction: 'received' | 'transferred',
  recipientFirstName: string | null,
  otherPartyName: string | null,
): EmailSample {
  return sample('groupOwnershipTransferredTemplate', {
    name,
    // The new owner reads 'received'; the old owner, now a plain
    // member, reads 'transferred'.
    audience: direction === 'received' ? 'group owner' : 'group member',
    variant,
    subject: (locale) =>
      direction === 'received'
        ? translate(
            locale,
            'email.group.ownershipTransferred.received.subject',
            { name: otherPartyName || null, group: GROUP.name },
          )
        : translate(
            locale,
            'email.group.ownershipTransferred.transferred.subject',
            { group: GROUP.name },
          ),
    args: (locale) => [
      {
        direction,
        recipientFirstName,
        otherPartyName,
        groupName: GROUP.name,
        groupLink: GROUP_LINK,
        locale,
      },
    ],
  });
}

function groupJoinRequestDecided(
  name: string,
  variant: string,
  decision: 'approved' | 'rejected',
  requesterFirstName: string | null,
): EmailSample {
  return sample('groupJoinRequestDecidedTemplate', {
    name,
    audience: 'group member',
    variant,
    subject: (locale) =>
      translate(locale, `email.group.joinRequestDecided.${decision}.subject`, {
        group: GROUP.name,
      }),
    args: (locale) => [
      {
        decision,
        requesterFirstName,
        groupName: GROUP.name,
        groupLink: GROUP_LINK,
        groupsListLink: `${APP}/groups/discover`,
        locale,
      },
    ],
  });
}

function groupRoleChanged(
  name: string,
  variant: string,
  memberFirstName: string | null,
  oldRole: string,
  newRole: string,
): EmailSample {
  return sample('groupRoleChangedTemplate', {
    name,
    audience: 'group member',
    variant,
    subject: (locale) =>
      translate(locale, 'email.group.roleChanged.subject', {
        group: GROUP.name,
        role: newRole,
      }),
    args: (locale) => [
      {
        memberFirstName,
        groupName: GROUP.name,
        oldRole,
        newRole,
        groupLink: GROUP_LINK,
        locale,
      },
    ],
  });
}

const group: EmailSample[] = [
  groupInvitation('group/invitation', 'typical', DAN.full, MESSAGE),
  groupInvitation(
    'group/invitation:no-message',
    'no message',
    DAN.full,
    undefined,
  ),
  groupInvitation(
    'group/invitation:no-inviter-name',
    'no inviter name',
    null,
    MESSAGE,
  ),

  groupInvitationAccepted(
    'group/invitation-accepted',
    'typical',
    DAN.first,
    ANA.full,
    GROUP.name,
  ),
  groupInvitationAccepted(
    'group/invitation-accepted:no-names',
    'no names',
    null,
    null,
    GROUP.name,
  ),
  groupInvitationAccepted(
    'group/invitation-accepted:no-group-name',
    'no group name',
    DAN.first,
    ANA.full,
    null,
  ),

  // `InvitationService` passes the inviter's FULL name here, so that is
  // what the greeting shows.
  groupInvitationDeclined(
    'group/invitation-declined',
    'typical',
    DAN.full,
    ANA.full,
  ),
  groupInvitationDeclined(
    'group/invitation-declined:no-names',
    'no names',
    null,
    null,
  ),

  groupMemberLeft('group/member-left', 'typical', DAN.first, ANA.full),
  groupMemberLeft('group/member-left:no-names', 'no names', null, null),

  groupMemberRemoved('group/member-removed', 'typical', ANA.first),
  groupMemberRemoved('group/member-removed:no-name', 'no name', null),

  groupJoinRequestReceived(
    'group/join-request-received',
    'typical, with message',
    DAN.first,
    ANA.full,
    MESSAGE,
  ),
  groupJoinRequestReceived(
    'group/join-request-received:no-message',
    'no message',
    DAN.first,
    ANA.full,
    undefined,
  ),
  groupJoinRequestReceived(
    'group/join-request-received:no-names',
    'no names',
    null,
    null,
    undefined,
  ),

  groupOwnershipTransferred(
    'group/ownership-transferred:received',
    'received',
    'received',
    ANA.first,
    DAN.full,
  ),
  groupOwnershipTransferred(
    'group/ownership-transferred:received-no-names',
    'received, no names',
    'received',
    null,
    null,
  ),
  groupOwnershipTransferred(
    'group/ownership-transferred:transferred',
    'transferred',
    'transferred',
    DAN.first,
    ANA.full,
  ),
  groupOwnershipTransferred(
    'group/ownership-transferred:transferred-no-names',
    'transferred, no names',
    'transferred',
    null,
    null,
  ),

  groupJoinRequestDecided(
    'group/join-request-decided:approved',
    'approved',
    'approved',
    ANA.first,
  ),
  groupJoinRequestDecided(
    'group/join-request-decided:approved-no-name',
    'approved, no name',
    'approved',
    null,
  ),
  groupJoinRequestDecided(
    'group/join-request-decided:rejected',
    'rejected',
    'rejected',
    ANA.first,
  ),
  groupJoinRequestDecided(
    'group/join-request-decided:rejected-no-name',
    'rejected, no name',
    'rejected',
    null,
  ),

  // The only two changes `GroupService` makes through this path; an
  // owner change is the ownership-transferred email.
  groupRoleChanged(
    'group/role-changed:promoted',
    'member to moderator',
    ANA.first,
    'MEMBER',
    'MODERATOR',
  ),
  groupRoleChanged(
    'group/role-changed:demoted',
    'moderator to member',
    ANA.first,
    'MODERATOR',
    'MEMBER',
  ),
  groupRoleChanged(
    'group/role-changed:no-name',
    'no name',
    null,
    'MEMBER',
    'MODERATOR',
  ),
];

// ── client ──

function clientInvitationNewUser(
  name: string,
  variant: string,
  message: string | undefined,
): EmailSample {
  return sample('clientInvitationNewUserTemplate', {
    name,
    audience: 'new user',
    variant,
    subject: (locale) =>
      translate(locale, 'email.client.invitationNewUser.subject', {
        name: DAN.full,
      }),
    args: (locale) => [
      {
        instructorName: DAN.full,
        signUpLink: `${APP}/auth/signup?token=sample-client-invite-token`,
        message,
        locale,
      },
    ],
  });
}

function clientInvitationExistingUser(
  name: string,
  variant: string,
  recipientFirstName: string | null,
  message: string | undefined,
): EmailSample {
  return sample('clientInvitationExistingUserTemplate', {
    name,
    audience: 'client',
    variant,
    subject: (locale) =>
      translate(locale, 'email.client.invitationExistingUser.subject', {
        name: DAN.full,
      }),
    args: (locale) => [
      {
        recipientFirstName,
        instructorName: DAN.full,
        acceptLink: `${APP}/profile?tab=coaches&requestId=${REQUEST_ID}`,
        message,
        locale,
      },
    ],
  });
}

function clientInvitationImported(
  name: string,
  variant: string,
  opts: {
    hasAccount: boolean;
    recipientFirstName: string | null;
    message: string | undefined;
  },
): EmailSample {
  return sample('clientInvitationImportedTemplate', {
    name,
    audience: opts.hasAccount ? 'client' : 'new user',
    variant,
    subject: (locale) =>
      translate(locale, 'email.client.invitationImported.subject', {
        name: DAN.full,
      }),
    args: (locale) => [
      {
        recipientFirstName: opts.recipientFirstName,
        instructorName: DAN.full,
        instructorAvatarUrl: null,
        link: opts.hasAccount
          ? `${APP}/profile?tab=coaches&requestId=${REQUEST_ID}`
          : `${APP}/auth/signup?token=sample-client-invite-token`,
        hasAccount: opts.hasAccount,
        message: opts.message,
        locale,
      },
    ],
  });
}

function clientRequestToInstructor(
  name: string,
  variant: string,
  instructorFirstName: string | null,
  message: string | undefined,
): EmailSample {
  return sample('clientRequestToInstructorTemplate', {
    name,
    audience: 'instructor',
    variant,
    subject: (locale) =>
      translate(locale, 'email.client.requestToInstructor.subject', {
        name: ANA.full,
      }),
    args: (locale) => [
      {
        instructorFirstName,
        clientName: ANA.full,
        reviewLink: `${APP}/coaching/pending-requests?requestId=${REQUEST_ID}`,
        message,
        locale,
      },
    ],
  });
}

/**
 * The accepted / declined emails go to whoever SENT the request: the
 * client when a coach answered, the coach when a user answered the
 * invitation. Same copy, two readers.
 */
function clientRequestAccepted(
  name: string,
  variant: string,
  recipientRole: 'client' | 'instructor',
  recipientFirstName: string | null,
  responderName: string,
): EmailSample {
  return sample('clientRequestAcceptedTemplate', {
    name,
    audience: recipientRole,
    variant,
    subject: (locale) =>
      translate(
        locale,
        `email.client.requestAccepted.${recipientRole}.subject`,
        {
          name: responderName,
        },
      ),
    args: (locale) => [
      {
        recipientFirstName,
        responderName,
        recipientRole,
        appLink:
          recipientRole === 'instructor'
            ? `${APP}/coaching/clients`
            : `${APP}/profile?tab=coaches`,
        locale,
      },
    ],
  });
}

function clientRequestDeclined(
  name: string,
  variant: string,
  recipientRole: 'client' | 'instructor',
  recipientFirstName: string | null,
  responderName: string,
): EmailSample {
  return sample('clientRequestDeclinedTemplate', {
    name,
    audience: recipientRole,
    variant,
    subject: (locale) =>
      translate(
        locale,
        `email.client.requestDeclined.${recipientRole}.subject`,
      ),
    args: (locale) => [
      { recipientFirstName, responderName, recipientRole, locale },
    ],
  });
}

function collaborationEnded(
  name: string,
  variant: string,
  recipientRole: 'instructor' | 'client',
  endedBy: 'self' | 'other',
  recipientName: string | null,
): EmailSample {
  const otherPartyName = recipientRole === 'client' ? DAN.full : ANA.full;
  return sample('collaborationEndedTemplate', {
    name,
    audience: recipientRole,
    variant,
    subject: (locale) =>
      translate(
        locale,
        `email.client.collaborationEnded.${recipientRole}.${endedBy}.subject`,
        { name: otherPartyName },
      ),
    args: (locale) => [
      { recipientName, otherPartyName, endedBy, recipientRole, locale },
    ],
  });
}

const client: EmailSample[] = [
  clientInvitationNewUser(
    'client/invitation-new-user',
    'typical, with message',
    MESSAGE,
  ),
  clientInvitationNewUser(
    'client/invitation-new-user:no-message',
    'no message',
    undefined,
  ),

  clientInvitationExistingUser(
    'client/invitation-existing-user',
    'typical, with message',
    ANA.first,
    MESSAGE,
  ),
  clientInvitationExistingUser(
    'client/invitation-existing-user:no-message',
    'no message',
    ANA.first,
    undefined,
  ),
  clientInvitationExistingUser(
    'client/invitation-existing-user:no-name',
    'no name',
    null,
    MESSAGE,
  ),

  clientInvitationImported(
    'client/invitation-imported',
    'no account, typical, with message',
    { hasAccount: false, recipientFirstName: ANA.first, message: MESSAGE },
  ),
  clientInvitationImported(
    'client/invitation-imported:no-name',
    'no account, no name, no message',
    { hasAccount: false, recipientFirstName: null, message: undefined },
  ),
  clientInvitationImported(
    'client/invitation-imported:has-account',
    'has an account',
    { hasAccount: true, recipientFirstName: ANA.first, message: MESSAGE },
  ),

  clientRequestToInstructor(
    'client/request-to-instructor',
    'typical, with message',
    DAN.first,
    MESSAGE,
  ),
  clientRequestToInstructor(
    'client/request-to-instructor:no-message',
    'no message',
    DAN.first,
    undefined,
  ),
  clientRequestToInstructor(
    'client/request-to-instructor:no-name',
    'no name',
    null,
    MESSAGE,
  ),

  clientRequestAccepted(
    'client/request-accepted:to-client',
    'a coach accepted the request',
    'client',
    ANA.first,
    DAN.full,
  ),
  clientRequestAccepted(
    'client/request-accepted:to-instructor',
    'a user accepted the invitation',
    'instructor',
    DAN.first,
    ANA.full,
  ),
  clientRequestAccepted(
    'client/request-accepted:no-name',
    'no name',
    'client',
    null,
    DAN.full,
  ),

  clientRequestDeclined(
    'client/request-declined:to-client',
    'a coach declined the request',
    'client',
    ANA.first,
    DAN.full,
  ),
  clientRequestDeclined(
    'client/request-declined:to-instructor',
    'a user declined the invitation',
    'instructor',
    DAN.first,
    ANA.full,
  ),
  clientRequestDeclined(
    'client/request-declined:no-name',
    'no name',
    'client',
    null,
    DAN.full,
  ),

  collaborationEnded(
    'client/collaboration-ended:client-self',
    'the client ended it, read by the client',
    'client',
    'self',
    ANA.first,
  ),
  collaborationEnded(
    'client/collaboration-ended:client-other',
    'the instructor ended it, read by the client',
    'client',
    'other',
    ANA.first,
  ),
  collaborationEnded(
    'client/collaboration-ended:instructor-self',
    'the instructor ended it, read by the instructor',
    'instructor',
    'self',
    DAN.first,
  ),
  collaborationEnded(
    'client/collaboration-ended:instructor-other',
    'the client ended it, read by the instructor',
    'instructor',
    'other',
    DAN.first,
  ),
  collaborationEnded(
    'client/collaboration-ended:client-self-no-name',
    'client, ended by self, no name',
    'client',
    'self',
    null,
  ),
  collaborationEnded(
    'client/collaboration-ended:client-other-no-name',
    'client, ended by the other, no name',
    'client',
    'other',
    null,
  ),
  collaborationEnded(
    'client/collaboration-ended:instructor-self-no-name',
    'instructor, ended by self, no name',
    'instructor',
    'self',
    null,
  ),
  collaborationEnded(
    'client/collaboration-ended:instructor-other-no-name',
    'instructor, ended by the other, no name',
    'instructor',
    'other',
    null,
  ),
];

// ── social ──

function friendInvite(
  name: string,
  variant: string,
  inviterName: string | null,
  personalMessage: string | undefined,
): EmailSample {
  return sample('friendInviteTemplate', {
    name,
    audience: 'new user',
    variant,
    subject: (locale) =>
      translate(locale, 'email.social.friendInvite.subject', {
        inviter: inviterName || null,
      }),
    args: (locale) => [
      {
        inviterName,
        signUpLink: `${APP}/auth/signup?ref=user-1`,
        personalMessage,
        locale,
      },
    ],
  });
}

function instructorSuggestion(
  name: string,
  variant: string,
  recommenderName: string | null,
  note: string | undefined,
): EmailSample {
  return sample('instructorSuggestionTemplate', {
    name,
    // A coach with no account yet.
    audience: 'new user',
    variant,
    subject: (locale) =>
      translate(locale, 'email.social.instructorSuggestion.subject', {
        recommender: recommenderName || null,
      }),
    args: (locale) => [
      {
        coachName: DAN.first,
        recommenderName,
        signUpLink: `${APP}/auth/signup?role=instructor`,
        note,
        locale,
      },
    ],
  });
}

const social: EmailSample[] = [
  friendInvite(
    'social/friend-invite',
    'typical, with message',
    ANA.full,
    MESSAGE,
  ),
  friendInvite(
    'social/friend-invite:no-message',
    'no message',
    ANA.full,
    undefined,
  ),
  friendInvite(
    'social/friend-invite:no-inviter-name',
    'no inviter name',
    null,
    MESSAGE,
  ),

  instructorSuggestion(
    'social/instructor-suggestion',
    'typical, with note',
    ANA.full,
    'Dan este cel mai bun antrenor cu care am lucrat.',
  ),
  instructorSuggestion(
    'social/instructor-suggestion:no-note',
    'no note',
    ANA.full,
    undefined,
  ),
  instructorSuggestion(
    'social/instructor-suggestion:no-recommender-name',
    'no recommender name',
    null,
    undefined,
  ),
];

// ── invoice ──

function invoiceSend(
  name: string,
  variant: string,
  overrides: Partial<InvoiceArgs> = {},
): EmailSample {
  const invoice = { ...INVOICE, ...overrides };
  return sample('invoiceSendTemplate', {
    name,
    audience: 'client',
    variant,
    subject: (locale) =>
      translate(locale, 'email.invoice.send.subject', {
        ref: invoice.invoiceNumber || null,
        instructor: invoice.instructorName || null,
      }),
    args: (locale) => [{ ...invoice, locale }],
  });
}

const invoice: EmailSample[] = [
  invoiceSend('invoice/send', 'typical'),
  invoiceSend('invoice/send:with-recipient-name', 'with recipient name', {
    recipientName: ANA.first,
  }),
  invoiceSend('invoice/send:no-due-date', 'no due date', {
    dueDate: null,
  }),
  invoiceSend('invoice/send:no-invoice-number', 'no invoice number', {
    invoiceNumber: null,
  }),
  invoiceSend('invoice/send:no-instructor-name', 'no instructor name', {
    instructorName: null,
  }),
  invoiceSend('invoice/send:no-pdf', 'no PDF link', {
    invoicePdfUrl: null,
  }),
];

// ── subscription ──

function subscriptionSetup(
  name: string,
  variant: string,
  overrides: Partial<SubscriptionArgs> = {},
): EmailSample {
  const subscription = { ...SUBSCRIPTION, ...overrides };
  return sample('subscriptionSetupTemplate', {
    name,
    audience: 'client',
    variant,
    subject: (locale) =>
      translate(locale, 'email.subscription.setup.subject', {
        instructor: subscription.instructorName || null,
        plan: subscription.planName,
      }),
    args: (locale) => [{ ...subscription, locale }],
  });
}

const subscription: EmailSample[] = [
  subscriptionSetup('subscription/setup:monthly', 'billed monthly (count 1)'),
  subscriptionSetup(
    'subscription/setup:every-3-months',
    'billed every 3 months (Romanian "few" plural)',
    { planName: 'Abonament trimestrial', intervalCount: 3 },
  ),
  subscriptionSetup(
    'subscription/setup:every-25-days',
    'billed every 25 days (Romanian "other" plural)',
    { planName: 'Abonament 25 de zile', interval: 'day', intervalCount: 25 },
  ),
  subscriptionSetup('subscription/setup:weekly', 'billed weekly', {
    planName: 'Abonament săptămânal',
    interval: 'week',
  }),
  subscriptionSetup(
    'subscription/setup:yearly',
    'billed yearly (no interval count stored)',
    { planName: 'Abonament anual', interval: 'year', intervalCount: null },
  ),
  subscriptionSetup(
    'subscription/setup:no-interval',
    'no interval (the "Billed" row is left out)',
    { interval: null, intervalCount: null },
  ),
  subscriptionSetup('subscription/setup:no-names', 'no names', {
    instructorName: null,
    recipientName: null,
  }),
];

// ── waitlist + feedback ──

function waitlistConfirmation(
  name: string,
  variant: string,
  visitorName: string | undefined,
): EmailSample {
  return sample('waitlistConfirmationTemplate', {
    name,
    audience: 'visitor',
    variant,
    subject: (locale) =>
      translate(locale, 'email.waitlist.confirmation.subject'),
    args: (locale) => [visitorName, `${APP}/auth/signup`, locale],
  });
}

function feedbackConfirmation(
  name: string,
  variant: string,
  type: string,
  title: string,
  visitorName: string | undefined,
): EmailSample {
  return sample('feedbackConfirmationTemplate', {
    name,
    audience: 'visitor',
    variant,
    subject: (locale) =>
      translate(locale, 'email.feedback.confirmation.subject'),
    args: (locale) => [type, title, visitorName, locale],
  });
}

const waitlist: EmailSample[] = [
  waitlistConfirmation('waitlist/confirmation', 'typical', ANA.first),
  waitlistConfirmation('waitlist/confirmation:no-name', 'no name', undefined),
];

// `FeedbackService` never passes a name, so the three typical cases
// have none.
const feedback: EmailSample[] = [
  feedbackConfirmation(
    'feedback/confirmation:bug',
    'bug report',
    'BUG',
    'Pagina grupului nu se încarcă pe telefon',
    undefined,
  ),
  feedbackConfirmation(
    'feedback/confirmation:suggestion',
    'suggestion',
    'SUGGESTION',
    'Aș vrea să pot exporta antrenamentele',
    undefined,
  ),
  feedbackConfirmation(
    'feedback/confirmation:other',
    'other',
    'OTHER',
    'Îmi place mult aplicația',
    undefined,
  ),
  feedbackConfirmation(
    'feedback/confirmation:with-name',
    'bug report, with name',
    'BUG',
    'Pagina grupului nu se încarcă pe telefon',
    ANA.first,
  ),
];

// ── notification ──

/**
 * The email `NotificationService` sends for a notification with the
 * email channel on: title and body rendered per reader from the
 * catalog, the title doubling as the subject. The button links to
 * `data.screen` and is labelled by the message's own `cta` when it has
 * one, by "Open MotionHive" otherwise; with no screen there is no
 * button. Same rules as `NotificationService.deliverToUser`.
 */
function notificationEmail(spec: {
  name: string;
  audience: EmailAudience;
  variant: string;
  message: NotificationMessage;
  ctaUrl?: string;
}): EmailSample {
  const params = (locale: Locale) => {
    const text = renderNotificationMessage(spec.message, locale);
    return {
      title: text.title,
      body: text.body,
      locale: text.locale,
      ctaUrl: spec.ctaUrl,
      ctaLabel: spec.ctaUrl
        ? (text.cta ?? translate(text.locale, 'email.layout.openApp'))
        : undefined,
    };
  };
  return sample('genericNotificationTemplate', {
    name: spec.name,
    audience: spec.audience,
    variant: spec.variant,
    subject: (locale) => params(locale).title,
    args: (locale) => [params(locale)],
  });
}

const notification: EmailSample[] = [
  notificationEmail({
    name: 'notification/generic',
    audience: 'instructor',
    variant: 'typical (client.requestReceived), default button label',
    message: { key: 'client.requestReceived', params: { name: ANA.full } },
    ctaUrl: `${APP}/coaching/pending-requests`,
  }),
  notificationEmail({
    name: 'notification/generic:no-name',
    audience: 'instructor',
    variant: 'no name',
    message: { key: 'client.requestReceived', params: { name: null } },
    ctaUrl: `${APP}/coaching/pending-requests`,
  }),
  notificationEmail({
    name: 'notification/generic:own-button-label',
    audience: 'client',
    variant: 'the message has its own button label (messaging.received)',
    message: {
      key: 'messaging.received',
      params: { name: DAN.full, preview: 'Ne vedem la 18:00?' },
    },
    ctaUrl: `${APP}/messages?conversationId=conv-1`,
  }),
  notificationEmail({
    name: 'notification/generic:no-button',
    audience: 'instructor',
    variant: 'no link to open, so no button',
    message: { key: 'client.requestReceived', params: { name: ANA.full } },
  }),
];

export const EMAIL_SAMPLES: EmailSample[] = [
  ...auth,
  ...account,
  ...group,
  ...client,
  ...social,
  ...invoice,
  ...subscription,
  ...waitlist,
  ...feedback,
  ...notification,
];
