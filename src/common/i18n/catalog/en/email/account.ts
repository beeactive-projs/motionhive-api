/**
 * Account deletion, from the code that confirms it to the note that it is
 * done. The dates are the erasure date (`day()`), rendered per reader.
 */
export const account = {
  deletionCode: {
    subject: 'Your code to delete your MotionHive account',
    preheader: 'Enter this code in the app to confirm it is you',
    eyebrow: 'SECURITY',
    heading: 'Confirm it is you',
    body: "{name, select, null {Hi there,} other {Hi {name},}} you asked to delete your MotionHive account. Enter this code in the app to confirm it's you.",
    expiry: 'The code works for 15 minutes.',
    warning:
      "If you didn't ask for this, someone may know your password. Change it now, and your account stays as it is.",
    cta: 'Change password',
    help: "Need help? Reply to this email, we're happy to assist.",
  },
  deletionScheduled: {
    subject: 'Your MotionHive account will be deleted on {date}',
    preheader: 'Changed your mind? Sign in before {date} to keep it.',
    eyebrow: 'YOUR ACCOUNT',
    heading: 'Your account is closing',
    body: '{name, select, null {Hi there,} other {Hi {name},}} your MotionHive account is deactivated, and on **{date}** we will delete it and erase your personal information.',
    woundDown:
      'Nobody can see your profile now. Your subscriptions will not renew, and your upcoming sessions and bookings are cancelled. Anyone affected has been told.',
    keep: 'Changed your mind? Sign in before **{date}** and choose to keep your account. What was cancelled stays cancelled.',
    cta: 'Sign in to keep my account',
    retained:
      'We keep only what the law requires: invoices and payment records for 5 years, and a record that your account was deleted, for 3 years.',
    help: "Need help? Reply to this email, we're happy to assist.",
  },
  deletionCancelled: {
    subject: 'Your MotionHive account will not be deleted',
    preheader: 'You signed in and kept your account',
    eyebrow: 'SECURITY',
    heading: 'Your account stays',
    body: '{name, select, null {Hi there,} other {Hi {name},}} you signed in and kept your MotionHive account, so it will not be deleted. Subscriptions, sessions and groups that ended when you asked to delete it stay ended.',
    warning: "If this wasn't you, change your password now.",
    cta: 'Change password',
    help: "Need help? Reply to this email, we're happy to assist.",
  },
  deletionCompleted: {
    subject: 'Your MotionHive account has been deleted',
    preheader: 'Your account and your personal information are gone',
    eyebrow: 'YOUR ACCOUNT',
    heading: 'Your account has been deleted',
    body: '{name, select, null {Hi there,} other {Hi {name},}} as you asked, we deleted your MotionHive account and erased your personal information.',
    retained:
      'We keep only what the law requires: invoices and payment records for 5 years, and a record that your account was deleted, for 3 years.',
    backups:
      'Our backups roll over within 90 days. Until then your information may still sit inside one, unused.',
    help: "Questions? Reply to this email, we're happy to help.",
  },
};
