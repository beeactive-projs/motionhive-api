/**
 * API Documentation for Session endpoints
 */

import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

export const SessionDocs = {
  create: {
    summary: 'Create a new session',
    description:
      'Create a training session. Requires INSTRUCTOR role. If groupId is provided, you must be a member of that group. ' +
      'For recurring sessions: set isRecurring to true and provide recurringRule (frequency, interval, daysOfWeek for WEEKLY, optional endDate or endAfterOccurrences). ' +
      'The created session is the first occurrence; use GET /sessions/:id/recurrence-preview to show dates and POST /sessions/:id/generate-instances to create future rows. ' +
      'If a scheduling conflict is detected (same time slot), the session is still created but the response includes warning and conflictingSessionIds.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Session created successfully',
        example: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          groupId: 'group-uuid-or-null',
          instructorId: 'user-uuid',
          title: 'Morning Yoga Flow',
          description: 'A relaxing yoga flow for all levels',
          sessionType: 'GROUP',
          visibility: 'GROUP',
          scheduledAt: '2026-02-15T09:00:00.000Z',
          durationMinutes: 60,
          location: 'Bucharest, Parcul Herăstrău',
          maxParticipants: 12,
          price: 50,
          currency: 'RON',
          status: 'SCHEDULED',
          isRecurring: false,
          recurringRule: null,
          createdAt: '2026-03-18T10:00:00.000Z',
          updatedAt: '2026-03-18T10:00:00.000Z',
          // Only present when a scheduling conflict was detected:
          warning: 'Schedule conflict with 1 existing session(s)',
          conflictingSessionIds: ['other-session-uuid'],
        },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  getMySessions: {
    summary: 'List my visible sessions (paginated)',
    description:
      'Returns paginated sessions visible to you. Includes: your own sessions, group sessions you belong to, PUBLIC sessions, and sessions you joined as participant. ' +
      'Query params: ?page=1&limit=20.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Sessions listed',
        example: {
          items: [
            {
              id: 'session-uuid',
              groupId: 'group-uuid-or-null',
              instructorId: 'user-uuid',
              title: 'Morning Yoga Flow',
              sessionType: 'GROUP',
              visibility: 'GROUP',
              scheduledAt: '2026-02-15T09:00:00.000Z',
              durationMinutes: 60,
              location: 'Bucharest',
              maxParticipants: 12,
              price: 50,
              currency: 'RON',
              status: 'SCHEDULED',
              isRecurring: false,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  discoverSessions: {
    summary: 'Discover public sessions',
    description:
      'Browse upcoming PUBLIC sessions. Supports search by title, description, or location. ' +
      'Query params: ?search=yoga&page=1&limit=20&sessionType=GROUP&dateFrom=2026-01-01&dateTo=2026-12-31.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Public sessions listed',
        example: {
          items: [
            {
              id: 'session-uuid',
              groupId: 'group-uuid-or-null',
              instructorId: 'user-uuid',
              title: 'Morning Yoga Flow',
              sessionType: 'GROUP',
              visibility: 'PUBLIC',
              scheduledAt: '2026-02-15T09:00:00.000Z',
              durationMinutes: 60,
              location: 'Bucharest',
              maxParticipants: 12,
              price: 50,
              currency: 'RON',
              status: 'SCHEDULED',
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  getById: {
    summary: 'Get session details',
    description:
      'Returns full session details including participants. Access controlled by visibility rules.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Session details retrieved',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  update: {
    summary: 'Update session',
    description:
      'Update session details. Instructor only. If status is changed to CANCELLED, all participants are notified.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Session updated',
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  delete: {
    summary: 'Delete session',
    description:
      'Soft-delete a session. Instructor only. All registered participants are notified via email.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Session deleted',
        example: { message: 'Session deleted successfully' },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  cloneSession: {
    summary: 'Clone/duplicate a session',
    description:
      'Create a copy of an existing session with a new scheduled date. Instructor only.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Session cloned',
        example: {
          id: '...',
          title: '...',
          scheduledAt: '2026-02-27T09:00:00.000Z',
        },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  recurrencePreview: {
    summary: 'Preview recurrence dates',
    description:
      'For a recurring session (isRecurring true + recurringRule), returns { dates: string[] } with ISO date-times for the next N weeks (?weeks=12, default 12). ' +
      'Does not create any sessions; use this to display occurrences on a calendar. Instructor only.',
    auth: true,
    responses: [
      {
        status: 200,
        description:
          'List of ISO date strings (includes the template session date)',
        example: {
          dates: [
            '2026-02-17T09:00:00.000Z',
            '2026-02-19T09:00:00.000Z',
            '2026-02-21T09:00:00.000Z',
          ],
        },
      },
      { status: 400, description: 'Session is not recurring or has no rule' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  generateInstances: {
    summary: 'Generate upcoming instances',
    description:
      'For a recurring session, creates new Session rows for each occurrence in the next N weeks (body: { weeks?: 12 }). ' +
      'Respects recurringRule endDate and endAfterOccurrences. Skips dates that already have a session (same instructor + title + time). ' +
      'Returns { created: number, sessions: Session[] }. Instructor only.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Instances created',
        example: { created: 24, sessions: [] },
      },
      { status: 400, description: 'Session is not recurring or has no rule' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  joinSession: {
    summary: 'Join a session',
    description:
      'Register as a participant. Checks visibility rules and capacity.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Successfully joined session',
      },
      {
        status: 400,
        description: 'Already registered, session full, or own session',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  leaveSession: {
    summary: 'Leave a session',
    description:
      'Cancel your registration. Cannot leave within 2 hours of session start (cancellation policy).',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Successfully left session',
        example: { message: 'You have left the session' },
      },
      {
        status: 400,
        description: 'Cannot cancel within 2 hours of session start',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  confirmRegistration: {
    summary: 'Confirm registration',
    description:
      'Confirm your attendance for a session. Changes status from REGISTERED to CONFIRMED.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Registration confirmed',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  selfCheckIn: {
    summary: 'Self check-in',
    description:
      'Check yourself in to a session. Available from 15 min before to 30 min after session start.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Checked in successfully',
      },
      {
        status: 400,
        description: 'Check-in window not active',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  updateParticipantStatus: {
    summary: 'Update participant status',
    description:
      "Change a participant's status (ATTENDED, NO_SHOW, etc.). Instructor only. Participant is notified.",
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Participant status updated',
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,
};
