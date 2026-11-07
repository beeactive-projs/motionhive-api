/**
 * Swagger doc objects for the admin module controllers. Same shape as the
 * other `common/docs/*.docs.ts` files — each entry is an
 * `ApiEndpointOptions` passed to `@ApiEndpoint(AdminDocs.x)`.
 */
export const AdminDocs = {
  // ── Users ────────────────────────────────────────────────────────
  listUsers: {
    summary: 'List users (cross-tenant)',
    description:
      'Paginated, filterable list of ALL users. Filters: q, role, isActive, isEmailVerified, locked, includeDeleted, onlyDeleted. ADMIN+.',
    auth: true,
    responses: [{ status: 200, description: 'Paginated users' }],
  },
  getUserDetail: {
    summary: 'User detail',
    description:
      'Full admin view of a user: roles, instructor profile, group/session/client counts, Stripe onboarding state, last-session metadata. ADMIN+.',
    auth: true,
    responses: [{ status: 200, description: 'User detail' }],
  },
  getUserActivity: {
    summary: 'User activity (GDPR-safe)',
    description:
      'Engagement COUNTS only (workouts, bookings, posts, messages sent, programs, routines) + last login + session counts. No content. ADMIN/SUPPORT+.',
    auth: true,
    responses: [{ status: 200, description: 'Activity counts' }],
  },
  updateUserStatus: {
    summary: 'Update user status',
    description:
      'Activate/deactivate, unlock (clear lockout), or force email-verified. ADMIN+.',
    auth: true,
    responses: [{ status: 200, description: 'Updated user detail' }],
  },
  resendVerification: {
    summary: 'Resend verification email',
    description:
      'Re-send the email-verification link to a user who is not yet verified. ADMIN+ (audited).',
    auth: true,
    responses: [{ status: 201, description: 'Sent' }],
  },
  assignRole: {
    summary: 'Assign role',
    description: 'Grant a system role to a user. SUPER_ADMIN only.',
    auth: true,
    responses: [{ status: 201, description: 'Updated role list' }],
  },
  revokeRole: {
    summary: 'Revoke role',
    description:
      "Remove a system role from a user (cannot revoke own admin role or a user's last role). SUPER_ADMIN only.",
    auth: true,
    responses: [{ status: 200, description: 'Updated role list' }],
  },
  scheduleUserDeletion: {
    summary: 'Delete an account on an emailed request',
    description:
      'For someone who asked by email to delete their account. `requestEmail` must be the account sign-in email the request came from. Same as confirming in the app: deactivates now, winds down, emails the person, erases within 30 days. ADMIN+ (audited).',
    auth: true,
    responses: [
      { status: 201, description: 'Updated user detail, with the deletion' },
      { status: 400, description: 'requestEmail is not the sign-in email' },
      { status: 404, description: 'User not found' },
      {
        status: 409,
        description:
          'Already scheduled, or a payment dispute needs their answer',
      },
    ],
  },
  restoreUser: {
    summary: 'Restore deleted user',
    description: 'Undo a soft-delete (paranoid restore). SUPER_ADMIN only.',
    auth: true,
    responses: [{ status: 200, description: 'Restored user detail' }],
  },

  // ── Impersonation ────────────────────────────────────────────────
  impersonate: {
    summary: 'Impersonate user',
    description:
      'Mint a short-lived (30m), refresh-less access token acting as the target user. Rejects self and admin targets. Audited. SUPER_ADMIN only.',
    auth: true,
    responses: [
      { status: 201, description: 'Impersonation token + target user' },
    ],
  },

  // ── DB browser ───────────────────────────────────────────────────
  listDbTables: {
    summary: 'List browsable tables',
    description:
      'Whitelisted read-only tables with row counts. SUPER_ADMIN only.',
    auth: true,
    responses: [{ status: 200, description: 'Table list' }],
  },
  getDbRows: {
    summary: 'Browse table rows',
    description:
      'Paginated, read-only rows for a whitelisted table; secret columns redacted. SUPER_ADMIN only.',
    auth: true,
    responses: [{ status: 200, description: 'Paginated rows' }],
  },

  // ── Overview ─────────────────────────────────────────────────────
  getOverview: {
    summary: 'Platform overview',
    description:
      'Dashboard counts: users (total/active/deleted), instructors, groups, sessions, active subs, open disputes, failed webhooks, open reports. ADMIN+.',
    auth: true,
    responses: [{ status: 200, description: 'Overview counts' }],
  },

  getInsights: {
    summary: 'Dashboard insights',
    description:
      'Engagement: signups (24h/7d/30d), active users (last-login proxy), 5 latest signups, and 7-day record-creation by domain. Efficient COUNTs. ADMIN/SUPPORT+.',
    auth: true,
    responses: [{ status: 200, description: 'Insights' }],
  },

  // ── Operations: jobs ─────────────────────────────────────────────
  jobsOverview: {
    summary: 'Jobs/queues overview',
    description:
      'Per-queue live counts (waiting/active/completed/failed/delayed/paused), triggerable sweep catalog, and the Bull Board path. ADMIN+.',
    auth: true,
    responses: [{ status: 200, description: 'Queues + triggerable jobs' }],
  },
  triggerJob: {
    summary: 'Trigger a sweep job',
    description:
      'Manually enqueue an idempotent sweep (e.g. payments.reconcile_webhooks). SUPER_ADMIN only.',
    auth: true,
    responses: [{ status: 201, description: 'Enqueue result' }],
  },
  listQueueJobs: {
    summary: 'Recent jobs for a queue',
    description:
      'Up to perState jobs per state (active/waiting/delayed/failed/completed), newest first. ADMIN/SUPPORT+.',
    auth: true,
    responses: [{ status: 200, description: 'Jobs list' }],
  },
  retryJob: {
    summary: 'Retry a job',
    description: 'Re-run a failed/completed job by id. SUPER_ADMIN only.',
    auth: true,
    responses: [{ status: 201, description: 'New job state' }],
  },

  // ── Operations: payments oversight ───────────────────────────────
  listAccounts: {
    summary: 'Stripe accounts',
    description:
      'Cross-tenant Connect accounts; filter=incomplete|disabled. ADMIN+.',
    auth: true,
    responses: [{ status: 200, description: 'Paginated accounts' }],
  },
  listSubscriptions: {
    summary: 'Subscriptions',
    description: 'Cross-tenant subscriptions; optional status filter. ADMIN+.',
    auth: true,
    responses: [{ status: 200, description: 'Paginated subscriptions' }],
  },
  listInvoices: {
    summary: 'Invoices',
    description: 'Cross-tenant invoices; optional status filter. ADMIN+.',
    auth: true,
    responses: [{ status: 200, description: 'Paginated invoices' }],
  },
  listDisputes: {
    summary: 'Disputes',
    description: 'Cross-tenant disputes; optional status filter. ADMIN+.',
    auth: true,
    responses: [{ status: 200, description: 'Paginated disputes' }],
  },
  listWebhooks: {
    summary: 'Webhook events',
    description:
      'Stripe webhook log (payload omitted); filter by status (failed/orphaned/processed). ADMIN+.',
    auth: true,
    responses: [{ status: 200, description: 'Paginated webhook events' }],
  },
  reprocessWebhook: {
    summary: 'Reprocess webhook',
    description:
      'Re-run a failed/orphaned webhook from its stored payload (idempotent). SUPER_ADMIN only.',
    auth: true,
    responses: [{ status: 201, description: 'New webhook status' }],
  },

  // ── Moderation: content ──────────────────────────────────────────
  listPosts: {
    summary: 'List posts',
    description: 'Cross-tenant posts with author brief. ADMIN/SUPPORT+.',
    auth: true,
    responses: [{ status: 200, description: 'Paginated posts' }],
  },
  deletePost: {
    summary: 'Delete post',
    description: 'Soft-delete (hide) a post. ADMIN+ (audited).',
    auth: true,
    responses: [{ status: 200, description: 'Deleted' }],
  },
  listWorkoutReports: {
    summary: 'List workout reports',
    description:
      'Reports about workouts shown on profiles, open and in-review first. ' +
      'Each row carries the reporter, the owner and the workout as the public ' +
      'saw it (the photo as `hasPhoto`). ADMIN/SUPPORT+.',
    auth: true,
    responses: [{ status: 200, description: 'Paginated workout reports' }],
  },
  resolveWorkoutReport: {
    summary: 'Resolve a workout report',
    description:
      'Moves a report on (OPEN to REVIEWING, RESOLVED or DISMISSED; REVIEWING ' +
      'to RESOLVED or DISMISSED). With `takeDown` (RESOLVED only) the workout ' +
      'leaves the profile and group cards, drops to Only me and can never be ' +
      'Public again; its other open reports close too, and the owner is told ' +
      'why. ADMIN+ (audited).',
    auth: true,
    responses: [
      { status: 200, description: 'The updated report' },
      {
        status: 400,
        description: 'Not an allowed move, or takeDown without RESOLVED',
      },
      { status: 404, description: 'No such report' },
    ],
  },
  workoutReportPhoto: {
    summary: "A reported workout's photo",
    description:
      'Streams the private photo of the reported workout (JPEG) for the ' +
      'person reviewing the report. Every view is audited. ADMIN/SUPPORT+.',
    auth: true,
    responses: [
      { status: 200, description: 'image/jpeg' },
      {
        status: 404,
        description: 'No such report, or the workout has no photo',
      },
    ],
  },
  listReviews: {
    summary: 'List reviews',
    description:
      'Cross-tenant instructor reviews with author brief. ADMIN/SUPPORT+.',
    auth: true,
    responses: [{ status: 200, description: 'Paginated reviews' }],
  },
  deleteReview: {
    summary: 'Delete review',
    description: 'Soft-delete a review. ADMIN+ (audited).',
    auth: true,
    responses: [{ status: 200, description: 'Deleted' }],
  },

  listFeedback: {
    summary: 'List feedback',
    description:
      'Paginated feedback with optional search (title/email/type). ADMIN/SUPPORT+.',
    auth: true,
    responses: [{ status: 200, description: 'Paginated feedback' }],
  },
  listWaitlist: {
    summary: 'List waitlist',
    description:
      'Paginated waitlist with optional search (email/name/source). ADMIN/SUPPORT+.',
    auth: true,
    responses: [{ status: 200, description: 'Paginated waitlist' }],
  },

  // ── Curated domains ──────────────────────────────────────────────
  listGroups: {
    summary: 'List groups',
    description: 'Cross-tenant groups with owner brief. ADMIN/SUPPORT+.',
    auth: true,
    responses: [{ status: 200, description: 'Paginated groups' }],
  },
  deleteGroup: {
    summary: 'Delete group',
    description: 'Soft-delete a group (spam moderation). ADMIN+ (audited).',
    auth: true,
    responses: [{ status: 200, description: 'Deleted' }],
  },
  getExercise: {
    summary: 'Exercise detail',
    description: 'Full exercise row for the admin edit form. ADMIN/SUPPORT+.',
    auth: true,
    responses: [{ status: 200, description: 'Exercise' }],
  },
  updateExercise: {
    summary: 'Edit exercise',
    description:
      'Update scalar fields of an exercise (seeded/system included). Relations out of scope. ADMIN+ (audited).',
    auth: true,
    responses: [{ status: 200, description: 'Updated exercise' }],
  },
  deleteExercise: {
    summary: 'Delete exercise',
    description:
      'Soft-delete an exercise (e.g. a bad seeded/system entry). ADMIN+ (audited).',
    auth: true,
    responses: [{ status: 200, description: 'Deleted' }],
  },
  listSessions: {
    summary: 'List sessions',
    description:
      'Cross-tenant session instances; status filter. ADMIN/SUPPORT+.',
    auth: true,
    responses: [{ status: 200, description: 'Paginated sessions' }],
  },
  listVenues: {
    summary: 'List venues',
    description: 'Cross-tenant venues. ADMIN/SUPPORT+.',
    auth: true,
    responses: [{ status: 200, description: 'Paginated venues' }],
  },
  listExercises: {
    summary: 'List exercises',
    description:
      'Cross-tenant exercise catalog; status=source filter. ADMIN/SUPPORT+.',
    auth: true,
    responses: [{ status: 200, description: 'Paginated exercises' }],
  },

  // ── Audit log ────────────────────────────────────────────────────
  listAuditLog: {
    summary: 'Admin action audit log',
    description:
      'Append-only log of admin mutations; optional action filter. ADMIN/SUPPORT+.',
    auth: true,
    responses: [{ status: 200, description: 'Paginated audit rows' }],
  },
};
