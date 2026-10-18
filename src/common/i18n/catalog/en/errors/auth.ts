export const auth = {
  invalidCredentials: 'The email or password is incorrect.',
  accountLocked:
    'Your account is locked after too many failed sign-in attempts. Try again in {minutes, plural, one {# minute} other {# minutes}}.',
  accountDeactivated: 'This account has been deactivated.',
  accountScheduledForDeletion:
    'This account is scheduled for deletion on {date}. You can still keep it.',
  noPasswordToChange:
    'You sign in with Google or Facebook, so there is no password to change.',
  currentPasswordIncorrect: 'Current password is incorrect.',
  samePassword: 'New password must be different from your current password.',
  passwordChanged: 'Your password was changed. Please log in again.',
  resetLinkInvalid:
    'This password reset link is invalid or has expired. Request a new one.',
  verificationLinkInvalid:
    'This verification link is invalid or has expired. Request a new one.',
  providerUnavailable: 'Signing in with {provider} is not available right now.',
  providerSignInFailed: "We couldn't sign you in with {provider}. Try again.",
  providerNoEmail:
    '{provider} did not share your email address, and we need it to sign you in.',
};
