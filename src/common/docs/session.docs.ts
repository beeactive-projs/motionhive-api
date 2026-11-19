import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

export const SessionDocs = {
  // -----------------------------------------------------------------------
  // Template endpoints (instructor, §4.1)
  // -----------------------------------------------------------------------

  createTemplate: {
    summary: 'Create a session template',
    description:
      'Creates a new session template. For non-recurring sessions (isRecurring=false), also atomically creates the single instance. ' +
      'For recurring sessions, instances are generated separately via POST /sessions/templates/:id/regenerate, ' +
      'or immediately if initialInstancesCount is provided.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Template (and initial instances) created',
        example: {
          template: {
            id: '...',
            slug: 'morning-yoga',
            title: 'Morning Yoga',
            status: 'ACTIVE',
          },
          generatedInstances: [],
          warnings: [],
        },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  listTemplates: {
    summary: 'List my session templates',
    description:
      'Returns paginated list of session templates owned by the authenticated instructor. ' +
      'Filter by tab (active/recurring/ended/cancelled), type, access, locationKind, groupId, or free-text search.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Paginated template list',
        example: { items: [], total: 0, page: 1, pageSize: 20 },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  getTemplate: {
    summary: 'Get a session template by ID',
    description:
      'Returns a single session template. Returns 404 if not found or not owned by the caller.',
    auth: true,
    responses: [
      { status: 200, description: 'Template found' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  updateTemplate: {
    summary: 'Update a session template',
    description:
      'Partially updates a session template. Only provided fields are changed. ' +
      'If meetingUrl is updated, meetingProvider is re-derived automatically. ' +
      'Does not modify existing instances.',
    auth: true,
    responses: [
      { status: 200, description: 'Template updated' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  deleteTemplate: {
    summary: 'End (delete) a session template',
    description:
      'Sets template status to ENDED and cancels all future SCHEDULED instances. Soft-deletes the template row.',
    auth: true,
    responses: [
      { status: 204, description: 'Template ended and instances cancelled' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  previewRecurrence: {
    summary: 'Preview recurrence occurrences (no DB write)',
    description:
      'Pure computation endpoint. Returns ISO 8601 UTC datetimes for a recurrence rule up to the specified horizon. ' +
      'truncated=true if the horizon cap was hit before the rule naturally ended.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Occurrence datetimes computed',
        example: {
          occurrences: ['2026-07-01T06:00:00.000Z', '2026-07-08T06:00:00.000Z'],
          truncated: false,
        },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  regenerateInstances: {
    summary: 'Generate more instances for a recurring template',
    description:
      'Generates the next N instances after the latest existing occurrence for this template. Idempotent within the rule bounds.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'New instances generated',
        example: { generatedInstances: [], warnings: [] },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  // ─── Instance read surface (Phase B) ───────────────────────────────

  listInstances: {
    summary: 'List session instances visible to the caller',
    description:
      "Returns instances within a date window. Defaults to the caller's own calendar; passing `instructorId` for another user returns only instances the caller is actively participating in. Hard 180-day max window.",
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Paginated instance list',
        example: { items: [], total: 0, page: 1, pageSize: 20 },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  getInstance: {
    summary: 'Get one session instance by id',
    description:
      "Returns the instance with its template (eagerly loaded). Owner sees the first 10 participants. Other authenticated users see only fields that don't leak booking data. 404 if not visible (no existence leak).",
    auth: true,
    responses: [
      { status: 200, description: 'Instance found' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  listParticipants: {
    summary: 'List participants for one instance (owner only)',
    description:
      'Returns paginated participants of an instance. Returns 404 for any caller other than the instance owner — same shape as if it did not exist.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Paginated participants list',
        example: { items: [], total: 0, page: 1, pageSize: 20 },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  // ─── Booking flow (Phase C) ────────────────────────────────────────

  bookInstance: {
    summary: 'Book a session',
    description:
      'Books the caller into the session instance. Returns CONFIRMED, PENDING_APPROVAL (if the template requires it), or WAITLISTED (if at capacity and waitlist is enabled). 409 ALREADY_BOOKED if non-terminal row exists. 409 CAPACITY_HIT_NO_WAITLIST if full + waitlist disabled. 403 if caller is not eligible by access kind. 400 if caller is the instructor (cannot book own session).',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Booking accepted',
        example: { status: 'CONFIRMED', participantId: '...' },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Conflict,
    ],
  } as ApiEndpointOptions,

  cancelBooking: {
    summary: 'Cancel my booking',
    description:
      "Cancels the caller's own booking. `cancellation` reports whether the cancellation fell within the as-booked window (snapshot, not the live template). When a confirmed seat is freed and waitlist is enabled, the oldest waitlister is auto-promoted (only if at least 2 hours remain before start).",
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Booking cancelled',
        example: {
          status: 'CANCELLED',
          cancellation: 'WITHIN_WINDOW',
          promotedUserId: null,
        },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
      ApiStandardResponses.Conflict,
    ],
  } as ApiEndpointOptions,

  approveParticipant: {
    summary: 'Approve a pending booking (instructor)',
    description:
      'Moves a PENDING_APPROVAL participant to CONFIRMED. If capacity has been hit in the meantime, lands as WAITLISTED (if waitlist enabled) or DECLINED otherwise.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Approved (or routed to waitlist/declined)',
        example: { status: 'CONFIRMED' },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  declineParticipant: {
    summary: 'Decline a pending booking (instructor)',
    description:
      'Moves a PENDING_APPROVAL participant to DECLINED with an optional reason shown to the client.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Declined',
        example: { status: 'DECLINED' },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  patchParticipant: {
    summary: 'Update attendance / private note (instructor)',
    description:
      'Sets `attended` (true/false/null) and/or `privateNote` on a participant row. Attendance can only be marked after `startAt`.',
    auth: true,
    responses: [
      { status: 200, description: 'Participant updated' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  // ─── Lifecycle (Phase D) ───────────────────────────────────────────

  cancelInstance: {
    summary: 'Cancel this / this+future / series (instructor)',
    description:
      'Cancels one occurrence or a future window. scope=series also flips the template to CANCELLED. Participants are notified ONCE per unique user, regardless of how many of their bookings were affected.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Cancellation applied',
        example: {
          scope: 'thisAndFuture',
          cancelledInstanceIds: [],
          notifiedUserIds: [],
        },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  rescheduleInstance: {
    summary: 'Reschedule a single instance (instructor)',
    description:
      'Moves `startAt` (and `endAt`, preserving duration). Recomputes conflicts. Fires SESSION_RESCHEDULED to every non-terminal participant exactly once.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Rescheduled',
        example: {
          instanceId: '...',
          oldStartAt: '...',
          newStartAt: '...',
          notifiedUserIds: [],
          warnings: [],
        },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  patchInstance: {
    summary: 'Set per-occurrence overrides (instructor)',
    description:
      'Override title/description/venue/meetingUrl/capacity for a single occurrence. Cross-resource ownership re-validated (foreign venueId → 404). Capacity cannot drop below current confirmedCount.',
    auth: true,
    responses: [
      { status: 200, description: 'Instance updated' },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  // ─── Public surface (Phase E) ──────────────────────────────────────

  discover: {
    summary: 'Browse upcoming sessions (public, optional auth)',
    description:
      'Anonymous callers see OPEN/FREE upcoming sessions only. Authenticated callers also see CLIENTS_ONLY sessions for instructors they have an active client relationship with, and GROUP_ONLY sessions for groups they currently belong to. Hard 90-day date window. Cached for 60s by HTTP layer; vary by Authorization. ' +
      "`template.categoryIds` is what a session trains: its group's categories when the group has some, else its coach's. " +
      'The categoryIds filter (ids from GET /categories, repeat the param or separate with commas, up to 30) keeps the sessions ' +
      'whose `template.categoryIds` hold any of them, by that same rule.',
    auth: false,
    responses: [
      {
        status: 200,
        description: 'Paginated public instance list',
        example: { items: [], total: 0, page: 1, pageSize: 20 },
      },
      ApiStandardResponses.BadRequest,
    ],
  } as ApiEndpointOptions,

  publicBySlug: {
    summary: 'Public session detail by handle + slug',
    description:
      'Resolves `motionhive.app/s/<instructorHandle>/<templateSlug>` to the next upcoming SCHEDULED instance. Only OPEN/FREE sessions are surfaced via this slug route — gated sessions return 404 here (use `/instances/:id/public` for the authenticated/blocked variants).',
    auth: false,
    responses: [
      { status: 200, description: 'Public instance shape' },
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  publicInstance: {
    summary: 'Public session detail by instance UUID',
    description:
      "Returns the public shape if caller is eligible (OPEN/FREE always; CLIENTS_ONLY active client; GROUP_ONLY current member). For GROUP_ONLY non-members returns a REDACTED 'blocked' shape (title + instructor + start time only) so the FE can render a 'join the group' CTA. For CLIENTS_ONLY non-clients returns 404.",
    auth: false,
    responses: [
      { status: 200, description: 'Public or blocked shape' },
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  // ─── Client utilities (Phase F) ────────────────────────────────────

  listMy: {
    summary: "List the caller's bookings",
    description:
      'Paginated list of bookings under one of five tabs: upcoming (confirmed + future), pendingApproval, waitlisted, past (confirmed + past), cancelled (cancelled or declined). Order ASC for active tabs, DESC for past/cancelled.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Paginated bookings',
        example: { items: [], total: 0, page: 1, pageSize: 20 },
      },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  myCounts: {
    summary: 'Profile badge counts for My Sessions tabs',
    description:
      'Four small COUNT(*) queries in parallel. Returns { upcoming, pendingApproval, waitlisted, past, cancelled }. No list payload — never use list endpoints for counts.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Counts',
        example: {
          upcoming: 0,
          pendingApproval: 0,
          waitlisted: 0,
          past: 0,
          cancelled: 0,
        },
      },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  icsDownload: {
    summary: 'Download a session as .ics (single VEVENT)',
    description:
      'Returns a `text/calendar` payload conforming to RFC 5545 with one VEVENT. Status reflects the session state (CONFIRMED or CANCELLED). Auth required: even OPEN/FREE sessions need a logged-in caller to download .ics (the file includes the meeting URL when applicable).',
    auth: true,
    responses: [
      { status: 200, description: 'iCalendar payload' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  followUp: {
    summary: 'Send a follow-up message to participants (instructor)',
    description:
      "Audience: 'all' (every non-terminal participant), 'attended', 'noshow', or an explicit 'userIds' list. Allowed only after `startAt`. The message is HTML-stripped server-side. Notifications are deduplicated per user; each recipient sees ONE message regardless of how their booking is shaped.",
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Follow-up dispatched',
        example: { notifiedUserIds: [] },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  joinInfo: {
    summary: 'Day-of meeting info for confirmed participants',
    description:
      'Returns the meeting URL plus a `joinActiveFrom` (startAt − 5 min) / `joinActiveUntil` (startAt + 15 min) window. The FE polls this every ~30s when the user is on the day-of screen. 403 if the caller is not a confirmed participant.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Join info',
        example: {
          meetingUrl: 'https://meet.google.com/abc',
          joinActiveFrom: '...',
          joinActiveUntil: '...',
          instructorJoined: false,
        },
      },
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,
};
