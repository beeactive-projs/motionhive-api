/**
 * Account deletion: the emailed code, the checks before it can go ahead,
 * and keeping an account during its cooling-off.
 */
export const account = {
  notYou: 'Only the person who owns this account can delete it.',
  noCodeRequested: 'Ask for a code first.',
  codeNotSent: "We couldn't send the code. Try again in a minute.",
  codeInvalid: "That code isn't right. Check the email and try again.",
  codeExpired: 'That code has expired. Ask for a new one.',
  codeTooManyAttempts: 'Too many wrong codes. Ask for a new one.',
  alreadyScheduled:
    'This account is already scheduled for deletion, on {date}.',
  requestEmailMismatch:
    "That isn't this account's sign-in email. Act only on a request sent from it.",
  theirOpenDispute:
    'This person has a payment dispute that needs their answer. They have to respond to it in Payments before the account can be deleted.',
  openDispute:
    'You have a payment dispute that needs your answer. Respond to it in Payments before you delete your account.',
  restoreExpired:
    'This chance to keep your account has expired. Sign in again to keep it.',
  notScheduled: 'This account is not scheduled for deletion.',
};
