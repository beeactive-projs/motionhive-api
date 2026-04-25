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
 * Sent right after sign-up so the user can verify their email and
 * unlock the rest of the platform. The link is single-use and
 * expires in 24h — the actual TTL lives in `UserService`.
 */
export function emailVerificationTemplate(verifyLink: string): string {
  const content = `
    ${heading('Verify your email')}
    ${subheading('One quick step to get started')}
    ${paragraph('Thanks for signing up for MotionHive! Please verify your email address to unlock all features and start your fitness journey.')}
    ${primaryButton('&#9989; Verify email address', verifyLink)}
    ${expiryNote('This verification link expires in <strong>24 hours</strong>.')}
    ${securityNote("If you didn't create a MotionHive account, you can safely ignore this email.")}
  `;

  return baseLayout(
    content,
    'Verify your email to get started with MotionHive',
  );
}
