import { Injectable, Inject } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Resend } from 'resend';
import {
  accountDeletionCancelledTemplate,
  accountDeletionCodeTemplate,
  accountDeletionCompletedTemplate,
  accountDeletionScheduledTemplate,
  clientInvitationExistingUserTemplate,
  clientInvitationNewUserTemplate,
  clientRequestAcceptedTemplate,
  clientRequestDeclinedTemplate,
  clientRequestToInstructorTemplate,
  collaborationEndedTemplate,
  emailVerificationTemplate,
  feedbackConfirmationTemplate,
  friendInviteTemplate,
  genericNotificationTemplate,
  groupJoinRequestDecidedTemplate,
  groupJoinRequestReceivedTemplate,
  groupMemberLeftTemplate,
  groupMemberRemovedTemplate,
  groupOwnershipTransferredTemplate,
  groupRoleChangedTemplate,
  instructorSuggestionTemplate,
  invitationDeclinedTemplate,
  invitationAcceptedTemplate,
  invitationTemplate,
  invoiceSendTemplate,
  passwordChangedTemplate,
  passwordResetTemplate,
  subscriptionSetupTemplate,
  waitlistConfirmationTemplate,
  welcomeTemplate,
} from '../email';
import { day, translate } from '../i18n';
import type { Locale } from '../i18n';

/**
 * Email Service
 *
 * Sends branded emails via Resend (https://resend.com).
 * Falls back to console logging when RESEND_API_KEY is not set.
 *
 * All email methods follow the same pattern:
 * - Build branded HTML from templates
 * - Send via Resend (or log in dev when no API key)
 * - Never throw on failure — email errors shouldn't break the main flow
 */
@Injectable()
export class EmailService {
  private readonly fromEmail: string;
  private readonly fromName: string;
  private readonly frontendUrl: string;
  private readonly apiUrl: string;
  private readonly isProduction: boolean;
  private readonly resend: Resend | null;

  constructor(
    private configService: ConfigService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {
    this.fromEmail =
      this.configService.get('EMAIL_FROM') || 'noreply@motionhive.fit';
    this.fromName = this.configService.get('EMAIL_FROM_NAME') || 'MotionHive';
    this.frontendUrl =
      this.configService.get('FRONTEND_URL') || 'http://localhost:4200';
    this.isProduction = this.configService.get('NODE_ENV') === 'production';

    // In dev, email links point to the API for direct verification
    const port = this.configService.get<number>('PORT') || 3000;
    this.apiUrl = `http://localhost:${port}`;

    // Initialize Resend if API key is available
    const resendApiKey = this.configService.get<string>('RESEND_API_KEY');
    if (resendApiKey) {
      this.resend = new Resend(resendApiKey);
      this.logger.log('Resend email provider initialized', 'EmailService');
    } else {
      this.resend = null;
      this.logger.warn(
        'RESEND_API_KEY not set — emails will be logged to console only',
        'EmailService',
      );
    }
  }

  /**
   * Get the base URL for email links.
   * In dev: points to API directly (http://localhost:PORT)
   * In prod: points to frontend (FRONTEND_URL)
   */
  private getBaseUrl(): string {
    return this.isProduction ? this.frontendUrl : this.apiUrl;
  }

  // =====================================================
  // AUTH EMAILS
  // =====================================================

  /**
   * Send email verification email
   */
  async sendEmailVerification(
    email: string,
    verificationToken: string,
    locale: Locale,
  ): Promise<void> {
    // In dev: link goes to API GET endpoint directly (returns inline
    // success/failure HTML — no FE needed for solo backend testing).
    // In prod: link goes to the FE, which calls POST /auth/verify-email
    // and renders a proper page. The FE route lives under /auth so
    // it sits alongside /auth/login, /auth/reset-password, etc.
    const verifyLink = this.isProduction
      ? `${this.frontendUrl}/auth/verify-email?token=${verificationToken}`
      : `${this.apiUrl}/auth/verify-email?token=${verificationToken}`;

    const subject = translate(locale, 'email.auth.verification.subject');
    const html = emailVerificationTemplate(verifyLink, locale);

    await this.send(email, subject, html);
  }

  /**
   * Send welcome email (called after email verification, not on registration)
   */
  async sendWelcomeEmail(
    email: string,
    firstName: string,
    locale: Locale,
  ): Promise<void> {
    const subject = translate(locale, 'email.auth.welcome.subject');
    const html = welcomeTemplate(firstName, this.frontendUrl, locale);

    await this.send(email, subject, html);
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(
    email: string,
    resetToken: string,
    locale: Locale,
  ): Promise<void> {
    // Frontend flow:
    // - /auth/reset-password -> requests a reset email
    // - /auth/new-password?token=... -> sets the new password
    const resetLink = `${this.frontendUrl}/auth/new-password?token=${resetToken}`;

    const subject = translate(locale, 'email.auth.passwordReset.subject');
    const html = passwordResetTemplate(resetLink, locale);

    await this.send(email, subject, html);
  }

  // =====================================================
  // INVITATION EMAILS
  // =====================================================

  /**
   * Send group invitation email
   */
  async sendInvitationEmail(
    email: string,
    invitationToken: string,
    inviterName: string | null,
    groupName: string,
    message: string | undefined,
    locale: Locale,
  ): Promise<void> {
    // Token lives on the path, not the query — FE route is `/join/:token`.
    const acceptLink = `${this.frontendUrl}/join/${invitationToken}`;

    const subject = translate(locale, 'email.group.invitation.subject', {
      group: groupName,
    });
    const html = invitationTemplate(
      inviterName,
      groupName,
      acceptLink,
      message,
      locale,
    );

    await this.send(email, subject, html);
  }

  // =====================================================
  // CLIENT INVITATION EMAILS
  // =====================================================

  /**
   * Send client invitation email to a recipient who does NOT yet have an
   * account. The signup link carries a token that auto-accepts the
   * invitation once registration completes.
   */
  /**
   * Friend-invite email (home-page "Invite a friend" dialog). Carries
   * the inviter's user id as `?ref=` so the referrer chain can be
   * picked up by the signup flow once BE attribution lands.
   */
  async sendFriendInviteEmail(
    email: string,
    inviterName: string | null,
    inviterUserId: string,
    personalMessage: string | undefined,
    locale: Locale,
  ): Promise<void> {
    const signUpLink = `${this.frontendUrl}/auth/signup?ref=${encodeURIComponent(inviterUserId)}`;
    const subject = translate(locale, 'email.social.friendInvite.subject', {
      inviter: inviterName || null,
    });
    const html = friendInviteTemplate({
      inviterName,
      signUpLink,
      personalMessage,
      locale,
    });
    await this.send(email, subject, html);
  }

  /**
   * Instructor-suggestion email (home-page "Suggest an instructor"
   * dialog, "Direct" tab). The CTA pre-selects the instructor signup
   * flow via `?role=instructor`.
   */
  async sendInstructorSuggestionEmail(
    email: string,
    coachName: string,
    recommenderName: string | null,
    note: string | undefined,
    locale: Locale,
  ): Promise<void> {
    const signUpLink = `${this.frontendUrl}/auth/signup?role=instructor`;
    const subject = translate(
      locale,
      'email.social.instructorSuggestion.subject',
      { recommender: recommenderName || null },
    );
    const html = instructorSuggestionTemplate({
      coachName,
      recommenderName,
      signUpLink,
      note,
      locale,
    });
    await this.send(email, subject, html);
  }

  async sendClientInvitationEmail(
    email: string,
    instructorName: string,
    message: string | undefined,
    token: string | undefined,
    locale: Locale,
  ): Promise<void> {
    const signUpLink = token
      ? `${this.frontendUrl}/auth/signup?token=${token}`
      : `${this.frontendUrl}/auth/signup?ref=client-invite`;

    const subject = translate(
      locale,
      'email.client.invitationNewUser.subject',
      { name: instructorName },
    );
    const html = clientInvitationNewUserTemplate({
      instructorName,
      signUpLink,
      message,
      locale,
    });

    await this.send(email, subject, html);
  }

  /**
   * Notify an instructor that a user has requested to become their client.
   * CTA deep-links to the instructor's Clients page.
   */
  async sendClientRequestToInstructorEmail(
    email: string,
    instructorFirstName: string | null,
    clientName: string,
    requestId: string,
    message: string | undefined,
    locale: Locale,
  ): Promise<void> {
    // Land on the pending-requests page (not the active clients list) and
    // highlight the specific row via the ?requestId param.
    const reviewLink = `${this.frontendUrl}/coaching/pending-requests?requestId=${encodeURIComponent(requestId)}`;
    const subject = translate(
      locale,
      'email.client.requestToInstructor.subject',
      { name: clientName },
    );
    const html = clientRequestToInstructorTemplate({
      instructorFirstName,
      clientName,
      reviewLink,
      message,
      locale,
    });
    await this.send(email, subject, html);
  }

  /**
   * Notify the request sender that their client request was accepted.
   * `responderName` is the user who accepted; `recipientFirstName` is
   * the sender's first name for the greeting.
   */
  async sendClientRequestAcceptedEmail(
    email: string,
    recipientFirstName: string | null,
    responderName: string,
    /** Who sent the request: a client, or a coach who sent an invitation. */
    recipientRole: 'client' | 'instructor',
    locale: Locale,
  ): Promise<void> {
    // Each side lands where the new relationship shows: a coach on their
    // clients list, a client on their coaches tab.
    const appLink =
      recipientRole === 'instructor'
        ? `${this.frontendUrl}/coaching/clients`
        : `${this.frontendUrl}/profile?tab=coaches`;
    const subject = translate(
      locale,
      `email.client.requestAccepted.${recipientRole}.subject`,
      { name: responderName },
    );
    const html = clientRequestAcceptedTemplate({
      recipientFirstName,
      responderName,
      recipientRole,
      appLink,
      locale,
    });
    await this.send(email, subject, html);
  }

  /**
   * Notify the request sender that their client request was declined.
   * Kept intentionally brief and non-punishing.
   */
  async sendClientRequestDeclinedEmail(
    email: string,
    recipientFirstName: string | null,
    responderName: string,
    /** Who sent the request: a client, or a coach who sent an invitation. */
    recipientRole: 'client' | 'instructor',
    locale: Locale,
  ): Promise<void> {
    const subject = translate(
      locale,
      `email.client.requestDeclined.${recipientRole}.subject`,
    );
    const html = clientRequestDeclinedTemplate({
      recipientFirstName,
      responderName,
      recipientRole,
      locale,
    });
    await this.send(email, subject, html);
  }

  /**
   * Send client invitation email to a recipient who already has a
   * MotionHive account. The CTA deep-links into the in-app incoming
   * requests page (auth-gated) where they can accept or decline.
   */
  async sendExistingUserClientInvitationEmail(
    email: string,
    recipientFirstName: string | null,
    instructorName: string,
    requestId: string,
    message: string | undefined,
    locale: Locale,
  ): Promise<void> {
    const acceptLink = `${this.frontendUrl}/profile?tab=coaches&requestId=${encodeURIComponent(requestId)}`;
    const subject = translate(
      locale,
      'email.client.invitationExistingUser.subject',
      { name: instructorName },
    );
    const html = clientInvitationExistingUserTemplate({
      recipientFirstName,
      instructorName,
      acceptLink,
      message,
      locale,
    });

    await this.send(email, subject, html);
  }

  // =====================================================
  // INVITATION RESPONSE EMAILS
  // =====================================================

  /**
   * Notify inviter that their group invitation was accepted
   */
  async sendInvitationAcceptedEmail(
    email: string,
    inviterName: string | null,
    accepterName: string | null,
    groupName: string | null,
    locale: Locale,
  ): Promise<void> {
    const subject = translate(
      locale,
      'email.group.invitationAccepted.subject',
      {
        name: accepterName || null,
        group: groupName || null,
      },
    );
    const html = invitationAcceptedTemplate(
      inviterName,
      accepterName,
      groupName,
      this.frontendUrl,
      locale,
    );

    await this.send(email, subject, html);
  }

  // =====================================================
  // WAITLIST & FEEDBACK EMAILS
  // =====================================================

  /**
   * Send waitlist confirmation email
   */
  async sendWaitlistConfirmation(
    email: string,
    name: string | undefined,
    locale: Locale,
  ): Promise<void> {
    const subject = translate(locale, 'email.waitlist.confirmation.subject');
    const signUpLink = `${this.frontendUrl}/auth/signup`;
    const html = waitlistConfirmationTemplate(name, signUpLink, locale);

    await this.send(email, subject, html);
  }

  /**
   * Send feedback confirmation email
   */
  async sendFeedbackConfirmation(
    email: string,
    type: string,
    title: string,
    name: string | undefined,
    locale: Locale,
  ): Promise<void> {
    const subject = translate(locale, 'email.feedback.confirmation.subject');
    const html = feedbackConfirmationTemplate(type, title, name, locale);

    await this.send(email, subject, html);
  }

  // =====================================================
  // INVOICE EMAILS
  // =====================================================

  /**
   * Send an invoice email via our own transport (Resend), used when the
   * instructor wants to deliver the invoice to an address that differs
   * from the customer's email on file in Stripe. Stripe's native
   * `sendInvoice` always goes to the customer's saved email, so we take
   * delivery over on this path and link to Stripe's hosted invoice page
   * and PDF.
   */
  async sendInvoiceEmail(params: {
    to: string;
    instructorName: string | null;
    amountCents: number;
    currency: string;
    dueDate: Date | string | null;
    invoiceNumber: string | null;
    hostedInvoiceUrl: string;
    invoicePdfUrl: string | null;
    recipientName?: string | null;
    locale: Locale;
  }): Promise<void> {
    const { to, locale, ...invoice } = params;

    const subject = translate(locale, 'email.invoice.send.subject', {
      ref: invoice.invoiceNumber || null,
      instructor: invoice.instructorName || null,
    });
    const html = invoiceSendTemplate({ ...invoice, locale });

    await this.send(to, subject, html);
  }

  /**
   * Sent to a client when their trainer creates a subscription for them
   * but they have no payment method on file. Links to a Stripe-hosted
   * setup page (Checkout in `setup` mode); once the card is saved Stripe
   * sets it as their default and the subscription auto-activates.
   */
  async sendSubscriptionSetupEmail(params: {
    to: string;
    instructorName: string | null;
    planName: string;
    amountCents: number;
    currency: string;
    interval: string | null;
    intervalCount?: number | null;
    setupUrl: string;
    recipientName?: string | null;
    locale: Locale;
  }): Promise<void> {
    const { to, locale, ...subscription } = params;
    // Subject leans into the consent ask, not "you got a subscription" —
    // the client hasn't gotten anything until they click confirm.
    const subject = translate(locale, 'email.subscription.setup.subject', {
      instructor: subscription.instructorName || null,
      plan: subscription.planName,
    });
    const html = subscriptionSetupTemplate({ ...subscription, locale });
    await this.send(to, subject, html);
  }

  /**
   * Sent to both parties when a coaching collaboration ends. The
   * `endedBy` flag selects the right copy ("you ended..." vs "they
   * ended..."), so the same method serves both recipients.
   */
  async sendCollaborationEndedEmail(params: {
    to: string;
    recipientName: string | null;
    otherPartyName: string;
    endedBy: 'self' | 'other';
    recipientRole: 'instructor' | 'client';
    locale: Locale;
  }): Promise<void> {
    const { to, ...collaboration } = params;
    const { recipientRole, endedBy, otherPartyName, locale } = collaboration;
    const subject = translate(
      locale,
      `email.client.collaborationEnded.${recipientRole}.${endedBy}.subject`,
      { name: otherPartyName },
    );
    const html = collaborationEndedTemplate(collaboration);
    await this.send(to, subject, html);
  }

  // =====================================================
  // NOTIFICATION SYSTEM
  // =====================================================

  /**
   * Generic notification email used by NotificationService when a
   * notification's email channel is enabled. `title` / `body` arrive
   * already rendered in the recipient's language; `locale` says which,
   * so the layout around them matches.
   *
   * Returns a status object so the caller can record per-channel outcome
   * on the notification_receipt row. This differs from other send methods
   * (which never throw) because the notification system needs to audit
   * delivery.
   */
  async sendNotificationEmail(params: {
    to: string;
    title: string;
    body: string;
    locale: Locale;
    ctaUrl?: string;
    ctaLabel?: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }> {
    const html = genericNotificationTemplate({
      title: params.title,
      body: params.body,
      locale: params.locale,
      ctaUrl: params.ctaUrl,
      ctaLabel: params.ctaLabel,
    });
    return this.sendWithStatus(params.to, params.title, html);
  }

  /**
   * Internal variant of `send()` that surfaces success/failure instead
   * of swallowing errors. Used by `sendNotificationEmail` so the
   * notification receipt can record the per-channel outcome.
   */
  private async sendWithStatus(
    to: string,
    subject: string,
    html: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const from = `${this.fromName} <${this.fromEmail}>`;

    if (!this.resend) {
      this.logger.log(
        `[EMAIL - DEV MODE] To: ${to} | Subject: ${subject} | From: ${from}`,
        'EmailService',
      );
      return { ok: true };
    }

    try {
      const { data, error } = await this.resend.emails.send({
        from,
        to: [to],
        subject,
        html,
      });
      if (error) {
        this.logger.error(
          `Failed to send notification email to ${to}: ${error.message}`,
          'EmailService',
        );
        return { ok: false, reason: error.message };
      }
      this.logger.log(
        `Notification email sent to ${to} | "${subject}" | ID: ${data?.id}`,
        'EmailService',
      );
      return { ok: true };
    } catch (err) {
      const reason = (err as Error).message;
      this.logger.error(
        `Failed to send notification email to ${to}: ${reason}`,
        'EmailService',
      );
      return { ok: false, reason };
    }
  }

  // =====================================================
  // SECURITY / ACCOUNT EMAILS
  // =====================================================

  /**
   * Sent to a logged-in user after they change their password via
   * `PATCH /auth/change-password`. Security flag: if it wasn't them,
   * the email gives them a one-click path back to /auth/forgot-password.
   * Does NOT fire on the forgot-password → reset-password flow — that
   * one self-confirms by sending the reset link.
   */
  async sendPasswordChangedEmail(
    email: string,
    firstName: string | null,
    changedAt: Date,
    locale: Locale,
    /** The user's zone, so the time reads as their own clock. */
    timeZone?: string,
  ): Promise<void> {
    const resetLink = `${this.frontendUrl}/auth/reset-password`;
    const subject = translate(locale, 'email.auth.passwordChanged.subject');
    const html = passwordChangedTemplate({
      firstName,
      changedAt,
      timeZone,
      resetLink,
      locale,
    });
    await this.send(email, subject, html);
  }

  // =====================================================
  // ACCOUNT DELETION EMAILS
  // =====================================================

  /**
   * The 6-digit code that confirms an account deletion. Reports whether it
   * went out: without it the person cannot go on, so the caller tells them
   * instead of leaving them waiting for an email that never comes.
   */
  async sendAccountDeletionCodeEmail(
    email: string,
    firstName: string | null,
    code: string,
    locale: Locale,
  ): Promise<boolean> {
    const subject = translate(locale, 'email.account.deletionCode.subject');
    const html = accountDeletionCodeTemplate({
      firstName,
      code,
      changePasswordLink: `${this.frontendUrl}/auth/reset-password`,
      locale,
    });
    const result = await this.sendWithStatus(email, subject, html);
    return result.ok;
  }

  /** The account is deactivated and will be erased on `scheduledFor`. */
  async sendAccountDeletionScheduledEmail(
    email: string,
    firstName: string | null,
    scheduledFor: Date,
    locale: Locale,
  ): Promise<void> {
    const subject = translate(
      locale,
      'email.account.deletionScheduled.subject',
      {
        date: day(scheduledFor),
      },
    );
    const html = accountDeletionScheduledTemplate({
      firstName,
      scheduledFor,
      signInLink: `${this.frontendUrl}/auth/login`,
      locale,
    });
    await this.send(email, subject, html);
  }

  /** They signed in during the cooling-off and kept the account. */
  async sendAccountDeletionCancelledEmail(
    email: string,
    firstName: string | null,
    locale: Locale,
  ): Promise<void> {
    const subject = translate(
      locale,
      'email.account.deletionCancelled.subject',
    );
    const html = accountDeletionCancelledTemplate({
      firstName,
      changePasswordLink: `${this.frontendUrl}/auth/reset-password`,
      locale,
    });
    await this.send(email, subject, html);
  }

  /** The erasure ran. `email` is the address the account had before it. */
  async sendAccountDeletionCompletedEmail(
    email: string,
    firstName: string | null,
    locale: Locale,
  ): Promise<void> {
    const subject = translate(
      locale,
      'email.account.deletionCompleted.subject',
    );
    const html = accountDeletionCompletedTemplate({ firstName, locale });
    await this.send(email, subject, html);
  }

  // =====================================================
  // GROUP MEMBERSHIP EMAILS
  // =====================================================

  /**
   * Sent to a group owner when a member leaves the group voluntarily.
   * Owner doesn't need to act — informational.
   */
  async sendGroupMemberLeftEmail(params: {
    to: string;
    ownerFirstName: string | null;
    memberName: string | null;
    groupName: string;
    groupId: string;
    locale: Locale;
  }): Promise<void> {
    const { to, ownerFirstName, memberName, groupName, groupId, locale } =
      params;
    const groupLink = `${this.frontendUrl}/groups/${groupId}`;
    const subject = translate(locale, 'email.group.memberLeft.subject', {
      name: memberName || null,
      group: groupName,
    });
    const html = groupMemberLeftTemplate({
      ownerFirstName,
      memberName,
      groupName,
      groupLink,
      locale,
    });
    await this.send(to, subject, html);
  }

  /**
   * Sent to a member who was removed by the group owner. CTA goes to
   * the groups list — they no longer have access to the group itself.
   */
  async sendGroupMemberRemovedEmail(params: {
    to: string;
    memberFirstName: string | null;
    groupName: string;
    locale: Locale;
  }): Promise<void> {
    const { to, memberFirstName, groupName, locale } = params;
    const groupsListLink = `${this.frontendUrl}/groups`;
    const subject = translate(locale, 'email.group.memberRemoved.subject', {
      group: groupName,
    });
    const html = groupMemberRemovedTemplate({
      memberFirstName,
      groupName,
      groupsListLink,
      locale,
    });
    await this.send(to, subject, html);
  }

  /**
   * Sent to a group owner when someone requests to join their
   * APPROVAL-policy group. CTA deep-links to the group's join-requests
   * page so the owner can approve or decline.
   */
  async sendGroupJoinRequestReceivedEmail(params: {
    to: string;
    ownerFirstName: string | null;
    requesterName: string | null;
    groupName: string;
    groupId: string;
    requestId: string;
    message?: string;
    locale: Locale;
  }): Promise<void> {
    const {
      to,
      ownerFirstName,
      requesterName,
      groupName,
      groupId,
      requestId,
      message,
      locale,
    } = params;
    // Join requests live inside the group-detail Members tab; the FE
    // can read ?requestId= and scroll-highlight the row (same pattern
    // as /profile?tab=coaches&requestId= and the instructor
    // pending-requests page).
    const reviewLink = `${this.frontendUrl}/groups/${groupId}/members?requestId=${encodeURIComponent(requestId)}`;
    const subject = translate(
      locale,
      'email.group.joinRequestReceived.subject',
      { name: requesterName || null, group: groupName },
    );
    const html = groupJoinRequestReceivedTemplate({
      ownerFirstName,
      requesterName,
      groupName,
      reviewLink,
      message,
      locale,
    });
    await this.send(to, subject, html);
  }

  /**
   * Sent to BOTH parties when group ownership is transferred. The
   * `direction` flag selects the right copy ("you received" vs "you
   * transferred"), so the same method serves both recipients — same
   * pattern as `sendCollaborationEndedEmail`.
   */
  async sendGroupOwnershipTransferredEmail(params: {
    to: string;
    direction: 'received' | 'transferred';
    recipientFirstName: string | null;
    otherPartyName: string | null;
    groupName: string;
    groupId: string;
    locale: Locale;
  }): Promise<void> {
    const {
      to,
      direction,
      recipientFirstName,
      otherPartyName,
      groupName,
      groupId,
      locale,
    } = params;
    const groupLink = `${this.frontendUrl}/groups/${groupId}`;
    const subject =
      direction === 'received'
        ? translate(
            locale,
            'email.group.ownershipTransferred.received.subject',
            {
              name: otherPartyName || null,
              group: groupName,
            },
          )
        : translate(
            locale,
            'email.group.ownershipTransferred.transferred.subject',
            { group: groupName },
          );
    const html = groupOwnershipTransferredTemplate({
      direction,
      recipientFirstName,
      otherPartyName,
      groupName,
      groupLink,
      locale,
    });
    await this.send(to, subject, html);
  }

  /**
   * Sent to the user who requested to join an APPROVAL-policy group,
   * once the owner decides. One method, two flavors — `decision`
   * picks the right copy and category.
   */
  async sendGroupJoinRequestDecidedEmail(params: {
    to: string;
    decision: 'approved' | 'rejected';
    requesterFirstName: string | null;
    groupName: string;
    groupId: string;
    locale: Locale;
  }): Promise<void> {
    const { to, decision, requesterFirstName, groupName, groupId, locale } =
      params;
    const groupLink = `${this.frontendUrl}/groups/${groupId}`;
    const groupsListLink = `${this.frontendUrl}/groups/discover`;
    const subject = translate(
      locale,
      `email.group.joinRequestDecided.${decision}.subject`,
      { group: groupName },
    );
    const html = groupJoinRequestDecidedTemplate({
      decision,
      requesterFirstName,
      groupName,
      groupLink,
      groupsListLink,
      locale,
    });
    await this.send(to, subject, html);
  }

  /**
   * Sent to a group inviter when the recipient declines the invite.
   * Symmetric to `sendInvitationAcceptedEmail`.
   */
  async sendGroupInvitationDeclinedEmail(
    email: string,
    inviterName: string | null,
    declinerName: string | null,
    groupName: string,
    locale: Locale,
  ): Promise<void> {
    const subject = translate(
      locale,
      'email.group.invitationDeclined.subject',
      {
        name: declinerName || null,
        group: groupName,
      },
    );
    const html = invitationDeclinedTemplate(
      inviterName,
      declinerName,
      groupName,
      locale,
    );
    await this.send(email, subject, html);
  }

  /**
   * Sent to a member when their role in a group changes (typically
   * member ↔ moderator).
   */
  async sendGroupRoleChangedEmail(params: {
    to: string;
    memberFirstName: string | null;
    groupName: string;
    groupId: string;
    /** Raw `GroupMemberRole` values; the catalog words them. */
    oldRole: string;
    newRole: string;
    locale: Locale;
  }): Promise<void> {
    const {
      to,
      memberFirstName,
      groupName,
      groupId,
      oldRole,
      newRole,
      locale,
    } = params;
    const groupLink = `${this.frontendUrl}/groups/${groupId}`;
    const subject = translate(locale, 'email.group.roleChanged.subject', {
      group: groupName,
      role: newRole,
    });
    const html = groupRoleChangedTemplate({
      memberFirstName,
      groupName,
      oldRole,
      newRole,
      groupLink,
      locale,
    });
    await this.send(to, subject, html);
  }

  // =====================================================
  // CORE SEND METHOD (Resend Integration)
  // =====================================================

  /**
   * Send an email via Resend
   *
   * Falls back to console logging if RESEND_API_KEY is not configured.
   * Never throws — email failure should not break the main application flow.
   */
  private async send(to: string, subject: string, html: string): Promise<void> {
    const from = `${this.fromName} <${this.fromEmail}>`;

    if (this.resend) {
      try {
        const { data, error } = await this.resend.emails.send({
          from,
          to: [to],
          subject,
          html,
        });

        if (error) {
          this.logger.error(
            `Failed to send email to ${to}: ${error.message}`,
            'EmailService',
          );
          return;
        }

        this.logger.log(
          `Email sent to ${to} | Subject: "${subject}" | ID: ${data?.id}`,
          'EmailService',
        );
      } catch (error) {
        this.logger.error(
          `Failed to send email to ${to}: ${(error as Error).message}`,
          'EmailService',
        );
        // Don't throw — email failure shouldn't break the main flow
      }
    } else {
      // No Resend API key — log email to console for development
      this.logger.log(
        `[EMAIL - DEV MODE] To: ${to} | Subject: ${subject} | From: ${from}`,
        'EmailService',
      );
      this.logger.debug?.(
        `[EMAIL HTML] ${html.substring(0, 200)}...`,
        'EmailService',
      );
    }
  }
}
