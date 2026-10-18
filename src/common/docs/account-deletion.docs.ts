/**
 * API documentation for account deletion (`/users/me/deletion`).
 */

import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

export const AccountDeletionDocs = {
  preview: {
    summary: 'What deleting my account would end',
    description:
      "Counts what deletion would wind down (subscriptions, bookings, coaches, groups; and for a coach: clients, sessions, groups and the people in them), the date the data would be erased, and anything that blocks deletion (an open payment dispute that needs the coach's answer).",
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Preview',
        example: {
          email: 'ana@example.com',
          scheduledFor: '2026-11-14T10:00:00.000Z',
          coolingOffDays: 30,
          asMember: { subscriptions: 1, bookings: 2, coaches: 1, groups: 3 },
          asCoach: {
            clients: 0,
            subscriptions: 0,
            upcomingSessions: 0,
            bookedPeople: 0,
            groups: 0,
            groupMembers: 0,
          },
          blockers: [],
        },
      },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  sendCode: {
    summary: 'Email a code to confirm deleting my account',
    description:
      "Sends a 6-digit code, valid 15 minutes, to the account address. A new request replaces the previous code. Refused under admin impersonation and while an open dispute needs the coach's answer (409, code OPEN_DISPUTE).",
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Code sent',
        example: { sentTo: 'ana@example.com' },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.Conflict,
    ],
  } as ApiEndpointOptions,

  confirm: {
    summary: 'Confirm deleting my account',
    description:
      'Checks the code (5 tries), then deactivates the account and signs it out everywhere, winds down everything shared with other people (each of them is told), and schedules erasure 30 days later. Signing in before then offers to keep the account.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Deletion scheduled',
        example: { scheduledFor: '2026-11-14T10:00:00.000Z' },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.Conflict,
    ],
  } as ApiEndpointOptions,
};
