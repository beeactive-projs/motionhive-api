import {
  baseLayout,
  expiryNote,
  heading,
  paragraph,
  primaryButton,
  securityNote,
  subheading,
} from '../_layouts/base-layout';

/**
 * Fired by `POST /auth/forgot-password`. The link contains a
 * single-use token (1h TTL) generated server-side; nothing about the
 * user's password is leaked here.
 */
export function passwordResetTemplate(resetLink: string): string {
  const content = `
    ${heading('Reset your password')}
    ${subheading('We received a password reset request')}
    ${paragraph("Click the button below to choose a new password. If you didn't make this request, you can safely ignore this email — your password won't change.")}
    ${primaryButton('&#128273; Reset password', resetLink)}
    ${expiryNote('This reset link expires in <strong>1 hour</strong> and can only be used once.')}
    ${securityNote("If you didn't request a password reset, someone may have entered your email by mistake. No changes have been made to your account.")}
  `;

  return baseLayout(content, 'Reset your MotionHive password');
}
