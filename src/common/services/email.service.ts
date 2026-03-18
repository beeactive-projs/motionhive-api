import { Injectable, Inject } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Resend } from 'resend';
import {
  emailVerificationTemplate,
  welcomeTemplate,
  passwordResetTemplate,
  invitationTemplate,
  sessionCancelledTemplate,
  invitationAcceptedTemplate,
  participantStatusTemplate,
  waitlistConfirmationTemplate,
  feedbackConfirmationTemplate,
} from './email-templates';

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
      this.configService.get('EMAIL_FROM') || 'noreply@beeactive.fit';
    this.fromName = this.configService.get('EMAIL_FROM_NAME') || 'BeeActive';
    this.frontendUrl =
      this.configService.get('FRONTEND_URL') || 'http://localhost:4200';
    this.isProduction = this.configService.get('NODE_ENV') === 'production';

    // In dev, email links point to the API for direct verification
    const port = this.configService.get('PORT') || 3000;
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
  ): Promise<void> {
    // In dev: link goes to API GET endpoint directly
    // In prod: link goes to frontend which calls the API
    const verifyLink = this.isProduction
      ? `${this.frontendUrl}/verify-email?token=${verificationToken}`
      : `${this.apiUrl}/auth/verify-email?token=${verificationToken}`;

    const subject = 'Verify your BeeActive email';
    const html = emailVerificationTemplate(verifyLink);

    await this.send(email, subject, html);
  }

  /**
   * Send welcome email (called after email verification, not on registration)
   */
  async sendWelcomeEmail(email: string, firstName: string): Promise<void> {
    const subject = 'Welcome to BeeActive!';
    const html = welcomeTemplate(firstName, this.frontendUrl);

    await this.send(email, subject, html);
  }

  /**
   * Send password reset email
   */
  async sendPasswordResetEmail(
    email: string,
    resetToken: string,
  ): Promise<void> {
    // Frontend flow:
    // - /auth/reset-password -> requests a reset email
    // - /auth/new-password?token=... -> sets the new password
    const resetLink = `${this.frontendUrl}/auth/new-password?token=${resetToken}`;

    const subject = 'Reset your BeeActive password';
    const html = passwordResetTemplate(resetLink);

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
    inviterName: string,
    groupName: string,
    message?: string,
  ): Promise<void> {
    const acceptLink = `${this.frontendUrl}/accept-invitation?token=${invitationToken}`;

    const subject = `You're invited to join ${groupName} on BeeActive`;
    const html = invitationTemplate(
      inviterName,
      groupName,
      acceptLink,
      message,
    );

    await this.send(email, subject, html);
  }

  // =====================================================
  // CLIENT INVITATION EMAILS
  // =====================================================

  /**
   * Send client invitation email (for users not yet on the platform)
   */
  async sendClientInvitationEmail(
    email: string,
    instructorName: string,
    message?: string,
  ): Promise<void> {
    const signUpLink = `${this.frontendUrl}/auth/signup?ref=client-invite`;

    const subject = `${instructorName} invited you to BeeActive`;
    const html = `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>You've been invited!</h2>
        <p><strong>${instructorName}</strong> would like you to join BeeActive as their client.</p>
        ${message ? `<p style="padding: 12px; background: #f5f5f5; border-radius: 8px; font-style: italic;">"${message}"</p>` : ''}
        <p>Create your account to get started:</p>
        <a href="${signUpLink}" style="display: inline-block; padding: 12px 24px; background: #f59e0b; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold;">Join BeeActive</a>
        <p style="margin-top: 24px; color: #666; font-size: 14px;">If you already have an account, just log in and the invitation will be waiting for you.</p>
      </div>
    `;

    await this.send(email, subject, html);
  }

  // =====================================================
  // SESSION NOTIFICATION EMAILS
  // =====================================================

  /**
   * Send session cancellation notification to a participant
   */
  async sendSessionCancelledEmail(
    email: string,
    participantName: string,
    sessionTitle: string,
    instructorName: string,
    scheduledAt: Date,
  ): Promise<void> {
    const formattedDate = scheduledAt.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const subject = `Session "${sessionTitle}" has been cancelled`;
    const html = sessionCancelledTemplate(
      participantName,
      sessionTitle,
      instructorName,
      formattedDate,
    );

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
    inviterName: string,
    accepterName: string,
    groupName: string,
  ): Promise<void> {
    const subject = `${accepterName} accepted your invitation to ${groupName}`;
    const html = invitationAcceptedTemplate(
      inviterName,
      accepterName,
      groupName,
    );

    await this.send(email, subject, html);
  }

  /**
   * Notify participant of a status change on their session registration
   */
  async sendParticipantStatusEmail(
    email: string,
    participantName: string,
    sessionTitle: string,
    newStatus: string,
    scheduledAt: Date,
  ): Promise<void> {
    const formattedDate = scheduledAt.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });

    const subject = `Session "${sessionTitle}" — status updated`;
    const html = participantStatusTemplate(
      participantName,
      sessionTitle,
      newStatus,
      formattedDate,
    );

    await this.send(email, subject, html);
  }

  // =====================================================
  // WAITLIST & FEEDBACK EMAILS
  // =====================================================

  /**
   * Send waitlist confirmation email
   */
  async sendWaitlistConfirmation(email: string, name?: string): Promise<void> {
    const subject = "You're on the BeeActive waitlist!";
    const html = waitlistConfirmationTemplate(name);

    await this.send(email, subject, html);
  }

  /**
   * Send feedback confirmation email
   */
  async sendFeedbackConfirmation(
    email: string,
    type: string,
    title: string,
    name?: string,
  ): Promise<void> {
    const subject = 'Thanks for your feedback!';
    const html = feedbackConfirmationTemplate(type, title, name);

    await this.send(email, subject, html);
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
