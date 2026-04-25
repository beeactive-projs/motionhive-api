import { escapeHtml } from '../../utils/html.utils';

/**
 * Client invitation to a recipient who does NOT yet have a MotionHive
 * account. Lighter visual shell than the branded `baseLayout` because
 * it lands in front of strangers — keep it close to a plain message.
 *
 * Sign-up link carries an opt-in token; once the recipient registers,
 * `acceptByToken` auto-accepts the invitation. Without a token they
 * can still sign up via the generic referral path.
 */
export function clientInvitationNewUserTemplate(params: {
  instructorName: string;
  signUpLink: string;
  message?: string;
}): string {
  const { instructorName, signUpLink, message } = params;
  const safeInstructor = escapeHtml(instructorName);
  const safeMessage = escapeHtml(message);

  return `
    <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>You've been invited!</h2>
      <p><strong>${safeInstructor}</strong> would like you to join MotionHive as their client.</p>
      ${message ? `<p style="padding: 12px; background: #f5f5f5; border-radius: 8px; font-style: italic;">"${safeMessage}"</p>` : ''}
      <p>Create your account to get started:</p>
      <a href="${signUpLink}" style="display: inline-block; padding: 12px 24px; background: #f59e0b; color: #fff; text-decoration: none; border-radius: 8px; font-weight: bold;">Join MotionHive</a>
      <p style="margin-top: 24px; color: #666; font-size: 14px;">If you already have an account, just log in and the invitation will be waiting for you.</p>
    </div>
  `;
}
