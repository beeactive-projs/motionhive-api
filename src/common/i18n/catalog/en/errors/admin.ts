/**
 * The admin app's errors that guard staff from each other: what an ADMIN
 * may do to an admin account, and to their own.
 */
export const admin = {
  /** Deactivating, unlocking, verifying or deleting the caller's own account. */
  notOnYourself: "You can't do this to your own account.",
  /** An ADMIN acting on an ADMIN or SUPER_ADMIN account. */
  superAdminOnly: 'Only a super admin can change an admin account.',
};
