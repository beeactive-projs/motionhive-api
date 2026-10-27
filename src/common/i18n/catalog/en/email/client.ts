/**
 * Coach ↔ client relationship emails (`src/common/email/client/`).
 *
 * `{name}` is always the OTHER person (the one the email is about),
 * `{recipient}` the reader's first name, `null` when unknown.
 * `messageQuote` / `messageLine` wrap the note the sender typed, so
 * each language uses its own quotation marks.
 */
export const client = {
  /** `sendClientInvitationEmail`: a coach invites someone with no account yet. */
  invitationNewUser: {
    subject: '{name} invited you to MotionHive',
    preheader: '{name} invited you to MotionHive',
    eyebrow: 'INVITATION',
    heading: "You've been invited!",
    subheading: '{name} wants you to join MotionHive as their client',
    personRole: 'Coach',
    body: '**{name}** would like you to join MotionHive as their client.',
    messageQuote: '"{message}"',
    messageLine: 'Message: "{message}"',
    cta: 'Join MotionHive',
    security:
      'If you already have an account, just log in and the invitation will be waiting for you.',
  },
  /** `sendExistingUserClientInvitationEmail`: a coach invites an existing user. */
  invitationExistingUser: {
    subject: '{name} wants to add you as a client on MotionHive',
    preheader: '{name} wants to add you as a client on MotionHive',
    eyebrow: 'CLIENT REQUEST',
    greeting: '{recipient, select, null {Hi,} other {Hi {recipient},}}',
    heading: '{name} sent you a client request',
    personRole: 'Coach',
    body: '**{name}** wants to add you as a client on MotionHive. Accept to start coordinating sessions, memberships and invoices together.',
    messageQuote: '"{message}"',
    messageLine: 'Message: "{message}"',
    cta: 'Review the request',
    security:
      "If you weren't expecting this, you can safely ignore the email or decline from your account.",
  },
  /**
   * `sendClientImportInvitationEmail`: a coach imported their client list.
   * The reader already knows the coach, so it reads as "your coach is
   * here", not a cold invite. `…New` / `…Existing` split on whether the
   * reader has an account; the coach is never told which.
   */
  invitationImported: {
    subject: '{name} added you as a client on MotionHive',
    preheader: '{name} invited you to train together on MotionHive.',
    eyebrow: 'INVITATION',
    greeting: '{recipient, select, null {Hi,} other {Hi {recipient},}}',
    heading: '{name} is now on MotionHive',
    personRole: 'Coach',
    bodyNew:
      '**{name}** added you to their client list on MotionHive. Create your account and you are connected straight away, with your programs, sessions and messages in one place.',
    bodyExisting:
      '**{name}** added you to their client list on MotionHive. Accept the request and your programs, sessions and messages are all in one place.',
    messageQuote: '"{message}"',
    messageLine: 'Message: "{message}"',
    ctaNew: 'Join {name} on MotionHive',
    ctaExisting: 'Review the request',
    expiry: 'The invitation is open for 30 days.',
    why: "You are getting this because {name} added your email address to their client list. If you don't know them, you can ignore this email.",
  },
  /** `sendClientRequestToInstructorEmail`: a user asks a coach to take them on. */
  requestToInstructor: {
    subject: '{name} wants to work with you on MotionHive',
    preheader: '{name} wants to work with you on MotionHive',
    eyebrow: 'NEW CLIENT REQUEST',
    greeting: '{recipient, select, null {Hi,} other {Hi {recipient},}}',
    heading: 'New client request',
    personRole: 'Prospective client',
    body: '**{name}** wants to work with you as a client.',
    messageQuote: '"{message}"',
    messageLine: 'Message: "{message}"',
    cta: 'Review the request',
  },
  /**
   * `sendClientRequestAcceptedEmail`: goes to whoever SENT the request,
   * which is the client (a coach accepted them) or the coach (a user
   * accepted the invitation). The template is not told which, so the
   * copy must hold for both: never call `{name}` a coach or a client.
   */
  requestAccepted: {
    greeting: '{recipient, select, null {Hi,} other {Hi {recipient},}}',
    cta: 'Open MotionHive',
    /** Read by the client: a coach accepted their request. */
    client: {
      subject: '{name} accepted your request on MotionHive',
      preheader: '{name} accepted your request on MotionHive',
      eyebrow: 'REQUEST ACCEPTED',
      heading: 'Request accepted',
      personRole: 'Your coach',
      body: '**{name}** accepted your request and is now your coach. You can now coordinate sessions, memberships and invoices together.',
    },
    /** Read by the coach: a user accepted their invitation. */
    instructor: {
      subject: '{name} accepted your invitation on MotionHive',
      preheader: '{name} accepted your invitation on MotionHive',
      eyebrow: 'INVITATION ACCEPTED',
      heading: 'Invitation accepted',
      personRole: 'Your new client',
      body: '**{name}** accepted your invitation and is now one of your clients. You can now coordinate sessions, memberships and invoices together.',
    },
  },
  /**
   * `sendClientRequestDeclinedEmail`: same two readers as
   * `requestAccepted`. Soft wording on purpose, and no call to action.
   */
  requestDeclined: {
    greeting: '{recipient, select, null {Hi,} other {Hi {recipient},}}',
    /** Read by the client: a coach declined their request. */
    client: {
      subject: 'Update on your request on MotionHive',
      preheader: 'Update on your request on MotionHive',
      heading: 'Request update',
      body: "**{name}** isn't able to take on your request at this time.",
      note: "You can find other coaches on MotionHive whenever you're ready.",
    },
    /** Read by the coach: a user declined their invitation. */
    instructor: {
      subject: 'Update on your invitation on MotionHive',
      preheader: 'Update on your invitation on MotionHive',
      heading: 'Invitation update',
      body: '**{name}** declined your invitation.',
      note: "You can invite other clients whenever you're ready.",
    },
  },
  /**
   * `sendCollaborationEndedEmail`: both people get one. First level is
   * who is reading (`client` / `instructor`, the `recipientRole`),
   * second is who ended it (`self` = the reader, `other` = `{name}`,
   * the `endedBy`). `subject` is also the preheader and the line under
   * the heading.
   */
  collaborationEnded: {
    heading: 'Collaboration ended',
    client: {
      self: {
        subject: 'You ended your collaboration with {name}',
        body: '{recipient, select, null {Hi there,} other {Hi {recipient},}} you ended your coaching collaboration with **{name}** on MotionHive. They no longer appear in your coaches list, and they can no longer invite you to their sessions.',
      },
      other: {
        subject: '{name} ended your collaboration',
        body: '{recipient, select, null {Hi there,} other {Hi {recipient},}} **{name}** ended your coaching collaboration on MotionHive. They no longer appear in your coaches list.',
      },
      membershipNote:
        'If you have an active membership with this trainer, it remains active until you cancel it from your billing page.',
      reconnect: 'You can always reconnect later by sending a new request.',
      footerNote:
        "You're receiving this because a coaching collaboration on your MotionHive account changed status.",
    },
    instructor: {
      self: {
        subject: 'You ended your collaboration with {name}',
        body: '{recipient, select, null {Hi there,} other {Hi {recipient},}} you ended your coaching collaboration with **{name}** on MotionHive. They no longer appear in your client list, and they can no longer see your private sessions.',
      },
      other: {
        subject: '{name} ended your collaboration',
        body: '{recipient, select, null {Hi there,} other {Hi {recipient},}} **{name}** ended your coaching collaboration on MotionHive. They no longer appear in your client list.',
      },
      membershipNote:
        "Any active memberships this client has with you remain in place until they (or you) cancel them. Stopping the training together doesn't cancel subscriptions automatically.",
      reconnect: 'You can always reconnect later by sending a new invitation.',
      footerNote:
        "You're receiving this because a coaching collaboration on your MotionHive account changed status.",
    },
  },
};
