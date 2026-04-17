/**
 * API Documentation for Client endpoints
 * Centralized location for all client-related Swagger documentation
 */

import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

export const ClientDocs = {
  getMyClients: {
    summary: 'List my clients',
    description:
      "List the authenticated instructor's clients with pagination and optional status filter. " +
      'Returns client info with group memberships. Query params: ?page=1&limit=20&status=ACTIVE|PENDING|ARCHIVED. ' +
      'When status is omitted, returns all statuses (ACTIVE + ARCHIVED rows from instructor_client merged with PENDING rows from client_request). ' +
      'PENDING rows include extra fields: invitedEmail (email-only invites), requestType, and expiresAt.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Clients listed',
        example: {
          items: [
            {
              id: 'client-relationship-uuid',
              instructorId: 'instructor-uuid',
              clientId: 'user-uuid',
              status: 'ACTIVE',
              initiatedBy: 'INSTRUCTOR',
              notes: 'Working on weight loss goals',
              startedAt: '2026-01-15T10:00:00.000Z',
              createdAt: '2026-01-01T10:00:00.000Z',
              updatedAt: '2026-01-15T10:00:00.000Z',
              client: {
                id: 'user-uuid',
                firstName: 'Jane',
                lastName: 'Doe',
                email: 'jane@example.com',
                avatarId: null,
              },
              groupMemberships: [
                { groupId: 'group-uuid', groupName: 'Morning HIIT Crew' },
              ],
            },
            {
              id: 'request-uuid',
              instructorId: 'instructor-uuid',
              clientId: null,
              status: 'PENDING',
              initiatedBy: 'INSTRUCTOR',
              notes: null,
              startedAt: null,
              createdAt: '2026-03-18T10:00:00.000Z',
              updatedAt: '2026-03-18T10:00:00.000Z',
              invitedEmail: 'newuser@example.com',
              requestType: 'INSTRUCTOR_TO_CLIENT',
              expiresAt: '2026-04-17T10:00:00.000Z',
              client: null,
              groupMemberships: [],
            },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  getMyInstructors: {
    summary: 'List my instructors',
    description:
      'List all instructors the authenticated user is an ACTIVE client of. Includes instructor profile info.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Instructors listed',
        example: [
          {
            id: 'client-relationship-uuid',
            instructorId: 'user-uuid',
            clientId: 'user-uuid',
            status: 'ACTIVE',
            startedAt: '2026-01-15T10:00:00.000Z',
            instructor: {
              id: 'user-uuid',
              firstName: 'John',
              lastName: 'Doe',
              email: 'john@example.com',
              avatarId: 'cloudinary-asset-id-or-null',
            },
            instructorProfile: {
              userId: 'user-uuid',
              displayName: 'Coach John',
              specializations: ['hiit', 'strength'],
              bio: 'Certified trainer with 8 years experience',
              locationCity: 'Bucharest',
              locationCountry: 'RO',
            },
          },
        ],
      },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  getPendingRequests: {
    summary: 'List pending requests',
    description:
      'List pending incoming client requests for the authenticated user. Excludes expired requests.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Pending requests listed',
        example: [
          {
            id: 'request-uuid',
            fromUserId: 'instructor-uuid',
            toUserId: 'user-uuid',
            type: 'INSTRUCTOR_TO_CLIENT',
            status: 'PENDING',
            message: 'Hi, I would love to train you!',
            expiresAt: '2026-04-17T10:00:00.000Z',
            createdAt: '2026-03-18T10:00:00.000Z',
            fromUser: {
              id: 'instructor-uuid',
              firstName: 'John',
              lastName: 'Doe',
              email: 'john@example.com',
              avatarId: 'cloudinary-asset-id-or-null',
            },
          },
        ],
      },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  sendInvitation: {
    summary: 'Send client invitation',
    description:
      'Instructor sends an invitation to a user by email to become their client. ' +
      'If the email belongs to an existing user, creates a pending client request. ' +
      'If not, sends an email invitation (the request is linked when they register).',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Client invitation sent',
        example: {
          message: 'Invitation sent to existing user',
          request: {
            id: 'request-uuid',
            fromUserId: 'instructor-uuid',
            toUserId: 'user-uuid',
            invitedEmail: null,
            type: 'INSTRUCTOR_TO_CLIENT',
            status: 'PENDING',
            message: 'Hi, join my training program!',
            expiresAt: '2026-04-17T10:00:00.000Z',
            createdAt: '2026-03-18T10:00:00.000Z',
          },
        },
      },
      {
        status: 400,
        description: 'Relationship already exists or pending request',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  requestToBeClient: {
    summary: 'Request to become a client',
    description:
      'User requests to become a client of the specified instructor. ' +
      'The instructor must have isAcceptingClients=true on their profile. ' +
      'Returns the created ClientRequest entity directly (not wrapped).',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Client request sent — returns the ClientRequest entity',
        example: {
          id: 'request-uuid',
          fromUserId: 'user-uuid',
          toUserId: 'instructor-uuid',
          invitedEmail: null,
          type: 'CLIENT_TO_INSTRUCTOR',
          status: 'PENDING',
          message: 'Hi, I would love to train with you!',
          expiresAt: '2026-04-17T10:00:00.000Z',
          createdAt: '2026-03-18T10:00:00.000Z',
        },
      },
      {
        status: 400,
        description: 'Instructor not accepting clients or relationship exists',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  acceptRequest: {
    summary: 'Accept client request',
    description:
      'Accept a pending client request. Creates/activates the instructor-client relationship.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Request accepted',
        example: { message: 'Request accepted successfully' },
      },
      { status: 400, description: 'Request already responded to or expired' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  declineRequest: {
    summary: 'Decline client request',
    description:
      'Decline a pending client request. Only the request recipient can decline. ' +
      'Also removes any PENDING instructor_client record created by the original invitation.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Request declined',
        example: { message: 'Request declined' },
      },
      {
        status: 400,
        description: 'Request already responded to (not PENDING)',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  cancelRequest: {
    summary: 'Cancel client request',
    description:
      'Cancel a pending client request that the authenticated user sent. ' +
      'Also removes any PENDING instructor_client record created by the original invitation.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Request cancelled',
        example: { message: 'Request cancelled' },
      },
      {
        status: 400,
        description: 'Request already responded to (not PENDING)',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  updateClient: {
    summary: 'Update client relationship',
    description:
      'Update notes or status (ACTIVE | ARCHIVED) for a client relationship. Instructor only. ' +
      'Returns the updated InstructorClient record.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Client updated — returns the InstructorClient record',
        example: {
          id: 'client-relationship-uuid',
          instructorId: 'instructor-uuid',
          clientId: 'user-uuid',
          status: 'ACTIVE',
          initiatedBy: 'INSTRUCTOR',
          notes: 'Prefers morning sessions. Working on upper body strength.',
          startedAt: '2026-01-15T10:00:00.000Z',
          createdAt: '2026-01-01T10:00:00.000Z',
          updatedAt: '2026-04-17T10:00:00.000Z',
        },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  archiveClient: {
    summary: 'Archive client relationship',
    description:
      'Archive (soft-remove) a client relationship by setting status to ARCHIVED. Instructor only. ' +
      'Returns the updated InstructorClient record.',
    auth: true,
    responses: [
      {
        status: 200,
        description:
          'Client archived — returns the updated InstructorClient record',
        example: {
          id: 'client-relationship-uuid',
          instructorId: 'instructor-uuid',
          clientId: 'user-uuid',
          status: 'ARCHIVED',
          initiatedBy: 'INSTRUCTOR',
          notes: null,
          startedAt: '2026-01-15T10:00:00.000Z',
          createdAt: '2026-01-01T10:00:00.000Z',
          updatedAt: '2026-04-17T10:00:00.000Z',
        },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  resendInvitation: {
    summary: 'Resend client invitation',
    description:
      'Resend an existing INSTRUCTOR_TO_CLIENT invitation. Refreshes expiry (+30 days), ' +
      'regenerates the token for email-only invites, and re-sends the invitation email. ' +
      'Only the instructor who sent the original invitation can resend it. ' +
      'Accepted, declined, and cancelled invitations cannot be resent.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Invitation resent',
        example: {
          message: 'Invitation resent successfully',
          request: {
            id: 'request-uuid',
            fromUserId: 'instructor-uuid',
            toUserId: null,
            invitedEmail: 'client@example.com',
            type: 'INSTRUCTOR_TO_CLIENT',
            status: 'PENDING',
            message: 'Join my training program!',
            token: 'new-token-hex',
            expiresAt: '2026-05-17T10:00:00.000Z',
            createdAt: '2026-03-18T10:00:00.000Z',
          },
        },
      },
      {
        status: 400,
        description: 'Invitation already accepted, declined, or cancelled',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  getPendingEmailInvites: {
    summary: 'List pending email invitations',
    description:
      'Instructor-only. Returns email-only invitations (toUserId IS NULL) — ' +
      'people who were invited but have not registered yet. ' +
      'Add ?includeExpired=true to also see expired/cancelled invitations.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Pending email invitations',
        example: [
          {
            id: 'request-uuid',
            invitedEmail: 'client@example.com',
            message: 'Join my training program!',
            status: 'PENDING',
            token: 'abc123',
            createdAt: '2026-03-18T10:00:00.000Z',
            expiresAt: '2026-04-17T10:00:00.000Z',
          },
        ],
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  getInviteByToken: {
    summary: 'Get invite details by token',
    description:
      'Public endpoint. Returns invitation details for the given token so the signup page ' +
      'can pre-fill the invited email and show the instructor name. ' +
      'Returns 404 if the token is unknown, 410 if expired or already used.',
    auth: false,
    responses: [
      {
        status: 200,
        description: 'Invite details',
        example: {
          token: 'abc123',
          invitedEmail: 'client@example.com',
          instructor: { firstName: 'John', lastName: 'Doe' },
          expiresAt: '2026-04-17T10:00:00.000Z',
        },
      },
      { status: 404, description: 'Token not found' },
      { status: 410, description: 'Token expired or already used' },
    ],
  } as ApiEndpointOptions,

  acceptByToken: {
    summary: 'Accept invitation by referral token',
    description:
      'Called immediately after a new user registers via a referral link. ' +
      'Links the newly created account to the pending ClientRequest and marks it as ACCEPTED. ' +
      'Requires the JWT issued at registration in the Authorization header.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Invitation accepted',
        example: { message: 'Invitation accepted successfully.' },
      },
      {
        status: 400,
        description: 'Token expired, already accepted, declined, or cancelled',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,
};
