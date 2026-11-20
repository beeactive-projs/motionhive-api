export const session = {
  bookingConfirmed: {
    title: 'Booking confirmed',
    body: 'You\'re in for "{title}" on {when}.',
  },
  bookingPending: {
    title: 'Booking pending approval',
    body: 'Waiting for the instructor to approve your booking for "{title}" on {when}.',
  },
  bookingWaitlisted: {
    title: 'Joined the waitlist',
    body: '"{title}" on {when} is full. We\'ll let you know if a seat opens.',
  },
  bookingApproved: {
    title: 'Booking approved',
    body: 'You\'re confirmed for "{title}" on {when}.',
  },
  bookingDeclined: {
    title: 'Booking declined',
    body: 'Your booking for "{title}" was not approved.{reason, select, null {} other { Reason: {reason}}}',
  },
  bookingDeclinedFull: {
    title: 'Booking declined',
    body: 'Your booking for "{title}" was not approved because the session is now full.',
  },
  bookingPromoted: {
    title: "You're in!",
    body: 'A seat opened up, so you\'re now confirmed for "{title}" on {when}.',
  },
  groupBookingsEnded: {
    title:
      '{count, plural, one {Booking cancelled} other {Bookings cancelled}}',
    body: '{count, plural, one {You\'re no longer in {group, select, null {the group} other {"{group}"}}, so your booking in its members-only session was cancelled.} other {You\'re no longer in {group, select, null {the group} other {"{group}"}}, so your # bookings in its members-only sessions were cancelled.}}',
  },
  groupDeletedBookingsEnded: {
    title:
      '{count, plural, one {Booking cancelled} other {Bookings cancelled}}',
    body: '{count, plural, one {{group, select, null {A group you were in} other {"{group}"}} was deleted, so your booking in its session was cancelled.} other {{group, select, null {A group you were in} other {"{group}"}} was deleted, so your # bookings in its sessions were cancelled.}}',
  },
  cancelled: {
    title: 'Session cancelled',
    body: '"{title}" on {when} has been cancelled.{reason, select, null {} other { Reason: {reason}.}}{note, select, null {} other { "{note}"}}',
  },
  rescheduled: {
    title: 'Session rescheduled',
    body: '"{title}" moved from {before} to {after}.',
  },
  reminder24h: {
    title: 'Session tomorrow',
    body: '"{title}" is on {when}.',
  },
  reminder1h: {
    title: 'Session starting soon',
    body: '"{title}" starts in about an hour ({when}).',
  },
  followUp: {
    title: 'Note from your coach after "{title}"',
    body: '{text}',
  },
  participantJoined: {
    title: 'New booking',
    body: '{name, select, null {A user} other {{name}}} booked into "{title}".',
  },
  participantLeft: {
    title: 'Booking cancelled',
    body: '{name, select, null {A user} other {{name}}} cancelled their booking for "{title}".',
  },
};
