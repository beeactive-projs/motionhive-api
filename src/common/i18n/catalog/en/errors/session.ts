export const session = {
  notFound: 'Session not found.',

  // Booking (the participant's side)
  cannotBookOwn: 'Cannot book your own session.',
  seriesNotActive: 'Session series is not active.',
  notBookable: 'Session is not bookable.',
  alreadyStarted: 'Session already started.',
  notEligible: 'Not eligible to book this session.',
  /** `status` is the existing booking's participant status. */
  alreadyBooked:
    '{status, select, WAITLISTED {You are already on the waitlist for this session.} PENDING_APPROVAL {You already asked to book this session. The coach has not answered yet.} other {You already have a booking for this session.}}',
  full: 'This session is full.',
  notActive: 'Session is not active.',
  bookingNotFound: 'Booking not found.',
  bookingAlreadyEnded: 'This booking was already cancelled or declined.',
  joinConfirmedOnly:
    'Only participants with a confirmed booking can join this session.',
  noMeetingLink: 'This session has no meeting link.',

  // Participants (the coach's side)
  pendingParticipantNotFound: 'Pending participant not found.',
  participantNotFound: 'Participant not found.',
  attendanceConfirmedOnly:
    'Only people who had a confirmed place can be marked as attended.',
  attendanceBeforeStart:
    'Attendance can only be set after the session has started.',

  // Creating and editing sessions
  invalidTimezone: 'Choose a valid time zone.',
  startInPast: 'Choose a start time in the future.',
  titleRequired: 'Add a title for the session.',
  notRecurring: 'This session is not part of a recurring series.',
  cannotCancel: 'This session can no longer be cancelled.',
  cannotReschedule: 'This session can no longer be rescheduled.',
  capacityBelowConfirmed:
    'The session already has {count, plural, one {# confirmed booking, so it needs at least # spot} other {# confirmed bookings, so it needs at least # spots}}.',

  // Messages to participants
  audienceBeforeStart:
    'You can message attendees or no-shows only after the session has started.',
  messageRequired: 'Write a message before sending.',
  recipientsRequired: 'Choose at least one participant.',

  // Date filters on session lists
  invalidDateRange: 'Invalid date range.',
  dateRangeOrder: 'The start date must be before the end date.',
  dateRangeTooWide:
    'Date range too wide. Choose at most {days, plural, one {# day} other {# days}}.',
};
