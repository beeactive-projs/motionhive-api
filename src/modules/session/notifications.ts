import type { NotifyParams } from '../notification/notification.service';
import { NotificationType } from '../notification/notification.service';
import { dayTime } from '../../common/i18n';

/**
 * Notification builders for the session module.
 *
 * Copy lives in the catalog (`notifications.session.*` under
 * src/common/i18n/catalog). Start times travel as `dayTime()` in the
 * session's zone and are printed per reader.
 *
 * Builders take **primitives** (id, name, Date) — never Sequelize entities.
 * Entities have lazy associations that explode when an outbox flushes
 * after commit. Callers are responsible for projecting the entity into
 * a `SessionRef`.
 *
 * Click targets:
 *   - Instructor screens live at /coaching/sessions/* (calendar, list, detail).
 *   - Client screens live at /sessions/* (discover, my, detail).
 *   - The detail page for a single occurrence is /sessions/instances/:id
 *     for both audiences (route guard differentiates).
 *
 * Defaults map (`notification-defaults.ts`):
 *   - reminders → in-app + email + push (24h) / in-app + push (1h)
 *   - cancel / reschedule → in-app + email + push
 *   - status changed / participant churn → in-app only
 */

export interface SessionRef {
  id: string; // instance id
  templateId: string;
  title: string;
  startAt: Date;
  timezone: string;
}

interface BookingResult {
  status:
    | 'CONFIRMED'
    | 'PENDING_APPROVAL'
    | 'WAITLISTED'
    | 'CANCELLED'
    | 'DECLINED';
}

// ─── To CLIENT (the person who booked) ────────────────────────────────

/** When the session starts, in the zone the instructor scheduled it in. */
function when(session: SessionRef) {
  return dayTime(session.startAt, session.timezone);
}

/** Booking outcome — confirmed, pending approval, or waitlisted. */
export function sessionBookedForUser(
  userId: string,
  session: SessionRef,
  result: BookingResult,
): NotifyParams {
  return {
    userId,
    // Reuse the lifecycle SESSION_STATUS_CHANGED bucket — informational,
    // in-app only by default. The defaults map currently has no dedicated
    // "BOOKING_CONFIRMED" type; we collapse here to keep the type catalogue
    // stable until we have a clear reason to split.
    type: NotificationType.SESSION_STATUS_CHANGED,
    message: {
      key:
        result.status === 'CONFIRMED'
          ? 'session.bookingConfirmed'
          : result.status === 'PENDING_APPROVAL'
            ? 'session.bookingPending'
            : 'session.bookingWaitlisted',
      params: { title: session.title, when: when(session) },
    },
    data: { screen: 'sessions', entityId: session.id },
  };
}

/** Client — instructor approved their pending booking. */
export function bookingApprovedForUser(
  userId: string,
  session: SessionRef,
): NotifyParams {
  return {
    userId,
    type: NotificationType.SESSION_STATUS_CHANGED,
    message: {
      key: 'session.bookingApproved',
      params: { title: session.title, when: when(session) },
    },
    data: { screen: 'sessions', entityId: session.id },
  };
}

/**
 * Client — instructor declined their pending booking. `reason` is the
 * instructor's own words, shown as written.
 */
export function bookingDeclinedForUser(
  userId: string,
  session: SessionRef,
  reason: string | null,
): NotifyParams {
  return {
    userId,
    type: NotificationType.SESSION_STATUS_CHANGED,
    message: {
      key: 'session.bookingDeclined',
      params: { title: session.title, reason: reason || null },
    },
    // A declined booking is listed with the cancelled ones.
    data: { screen: 'user/sessions', queryParams: { tab: 'cancelled' } },
  };
}

/**
 * Client — their pending booking was turned down by the system because
 * the session filled up. Its own message (not a `reason` string) so the
 * explanation is translated.
 */
export function bookingDeclinedSessionFullForUser(
  userId: string,
  session: SessionRef,
): NotifyParams {
  return {
    userId,
    type: NotificationType.SESSION_STATUS_CHANGED,
    message: {
      key: 'session.bookingDeclinedFull',
      params: { title: session.title },
    },
    data: { screen: 'user/sessions', queryParams: { tab: 'cancelled' } },
  };
}

/** Client — they got auto-promoted off the waitlist into a seat. */
export function bookingPromotedForUser(
  userId: string,
  session: SessionRef,
): NotifyParams {
  return {
    userId,
    type: NotificationType.SESSION_STATUS_CHANGED,
    message: {
      key: 'session.bookingPromoted',
      params: { title: session.title, when: when(session) },
    },
    data: { screen: 'sessions', entityId: session.id },
  };
}

/**
 * Client — they were removed from a group, or left it, so their open
 * bookings in its members-only sessions ended. One notice for all of them.
 */
export function groupBookingsEndedForUser(
  userId: string,
  group: { id: string; name: string | null },
  count: number,
): NotifyParams {
  return {
    userId,
    type: NotificationType.SESSION_CANCELLED,
    message: {
      key: 'session.groupBookingsEnded',
      params: { group: group.name, count },
    },
    data: { screen: 'user/sessions', queryParams: { tab: 'cancelled' } },
  };
}

/**
 * Client — the group was deleted, so its members-only sessions were
 * cancelled with their open bookings in them. One notice for all of them.
 */
export function groupDeletedBookingsEndedForUser(
  userId: string,
  group: { id: string; name: string | null },
  count: number,
): NotifyParams {
  return {
    userId,
    type: NotificationType.SESSION_CANCELLED,
    message: {
      key: 'session.groupDeletedBookingsEnded',
      params: { group: group.name, count },
    },
    data: { screen: 'user/sessions', queryParams: { tab: 'cancelled' } },
  };
}

/** Client — the instructor cancelled the session they were booked into. */
export function sessionCancelledForUser(
  userId: string,
  session: SessionRef,
  reason: string | null,
  message: string | null,
): NotifyParams {
  return {
    userId,
    type: NotificationType.SESSION_CANCELLED,
    message: {
      key: 'session.cancelled',
      params: {
        title: session.title,
        when: when(session),
        reason: reason || null,
        note: message || null,
      },
    },
    data: { screen: 'user/sessions', queryParams: { tab: 'cancelled' } },
  };
}

/** Client — the instructor rescheduled their session. */
export function sessionRescheduledForUser(
  userId: string,
  session: SessionRef,
  oldStartAt: Date,
): NotifyParams {
  return {
    userId,
    type: NotificationType.SESSION_RESCHEDULED,
    message: {
      key: 'session.rescheduled',
      params: {
        title: session.title,
        before: dayTime(oldStartAt, session.timezone),
        after: when(session),
      },
    },
    data: { screen: 'sessions', entityId: session.id },
  };
}

/** Client — generic 24h or 1h reminder before the session starts. */
export function sessionReminderForUser(
  userId: string,
  session: SessionRef,
  kind: 'REMINDER_24H' | 'REMINDER_1H',
): NotifyParams {
  const is24h = kind === 'REMINDER_24H';
  return {
    userId,
    type: is24h
      ? NotificationType.SESSION_REMINDER_24H
      : NotificationType.SESSION_REMINDER_1H,
    message: {
      key: is24h ? 'session.reminder24h' : 'session.reminder1h',
      params: { title: session.title, when: when(session) },
    },
    data: { screen: 'sessions', entityId: session.id },
  };
}

/** Client — instructor-sent follow-up message after the session ended. */
export function sessionFollowUpForUser(
  userId: string,
  session: SessionRef,
  message: string,
): NotifyParams {
  return {
    userId,
    // Dedicated channel — defaults to in-app + email (see
    // notification-defaults.ts). Users would expect to receive these
    // even if not opening the app the same day.
    type: NotificationType.SESSION_FOLLOW_UP,
    message: {
      key: 'session.followUp',
      params: {
        title: session.title,
        // The instructor's own words, whole: in the app and the email they
        // read as written (the API takes 2,000 characters); only the push
        // is shortened, as every push is.
        text: message,
      },
    },
    data: { screen: 'sessions', entityId: session.id },
  };
}

// ─── To INSTRUCTOR (audience = the session owner) ────────────────────

/** Instructor — a user booked into one of their sessions. */
export function participantJoinedForInstructor(
  instructorId: string,
  participantName: string | null,
  session: SessionRef,
): NotifyParams {
  return {
    userId: instructorId,
    type: NotificationType.PARTICIPANT_JOINED,
    message: {
      key: 'session.participantJoined',
      params: { name: participantName, title: session.title },
    },
    data: { screen: 'coaching/sessions', entityId: session.id },
  };
}

/** Instructor — a user cancelled their booking. */
export function participantLeftForInstructor(
  instructorId: string,
  participantName: string | null,
  session: SessionRef,
): NotifyParams {
  return {
    userId: instructorId,
    type: NotificationType.PARTICIPANT_LEFT,
    message: {
      key: 'session.participantLeft',
      params: { name: participantName, title: session.title },
    },
    data: { screen: 'coaching/sessions', entityId: session.id },
  };
}
