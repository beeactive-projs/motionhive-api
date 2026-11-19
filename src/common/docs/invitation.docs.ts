/**
 * API Documentation for Invitation endpoints
 * Centralized location for all invitation-related Swagger documentation
 */

import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

export const InvitationDocs = {
  create: {
    summary: 'Send an invitation',
    description:
      'Invite someone to join your group. Owner only. The link goes to the invitee by email only.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Invitation sent',
        example: {
          invitation: {
            id: 'invitation-uuid',
            email: 'mike@trainer.com',
            groupId: 'group-uuid',
            expiresAt: '2026-02-22T00:00:00.000Z',
          },
        },
      },
      { status: 400, description: 'Active invitation already exists' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  getMyPendingInvitations: {
    summary: 'Get my pending invitations (paginated)',
    description:
      "Returns the authenticated user's invitations still waiting on an answer (not expired, group still open), " +
      'newest first, as the invite card shows them: the inviter (no email or phone), the group (name, picture, ' +
      'description, `memberCount`, `categoryIds`) and the note. Accepts ?page=1&limit=20 query params.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Pending invitations listed',
        example: {
          items: [
            {
              id: 'invitation-uuid',
              inviter: {
                id: 'user-uuid',
                firstName: 'Sarah',
                lastName: 'Johnson',
                handle: 'sarah',
                avatarUrl: null,
              },
              group: {
                id: 'group-uuid',
                name: "Sarah's crew",
                slug: 'sarahs-crew',
                logoUrl: null,
                description: 'Share workouts and cheer each other on.',
                memberCount: 4,
                categoryIds: ['category-uuid'],
              },
              message: null,
              createdAt: '2026-11-14T08:00:00.000Z',
              expiresAt: '2026-12-14T08:00:00.000Z',
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

  inviteMembers: {
    summary: 'Invite several of my clients to my group',
    description:
      "Owner only. Every id must be one of the caller's active clients (403 otherwise). Members and people " +
      'with an invitation still open are skipped. Each invitee gets one in-app and push notification and ' +
      'answers in the app (`POST /invitations/mine/:id/accept`); no email or link is sent. Open for 30 days.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Invitations sent',
        example: { invited: 3, skipped: 1 },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  acceptMine: {
    summary: 'Accept one of my invitations',
    description:
      'Accept an invitation sent to your email, by its id (the invite card). Adds you to the group. ' +
      '404 for an invitation sent to someone else, so an id never confirms it exists.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Invitation accepted',
        example: {
          message: 'Invitation accepted successfully',
          groupId: 'group-uuid',
        },
      },
      {
        status: 400,
        description: 'Invitation expired, already accepted, or declined',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  declineMine: {
    summary: 'Decline one of my invitations',
    description:
      'Decline an invitation sent to your email, by its id. The inviter is told. 404 for anyone else.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Invitation declined',
        example: { message: 'Invitation declined' },
      },
      { status: 400, description: 'Invitation already answered' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  accept: {
    summary: 'Accept an invitation',
    description:
      'Accept an invitation using its token. Adds you to the group and assigns the role.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Invitation accepted',
        example: {
          message: 'Invitation accepted successfully',
          groupId: 'group-uuid',
        },
      },
      {
        status: 400,
        description: 'Invitation expired, already accepted, or declined',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  decline: {
    summary: 'Decline an invitation',
    description: 'Decline an invitation using its token.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Invitation declined',
        example: { message: 'Invitation declined' },
      },
      { status: 400, description: 'Invitation already responded to' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  cancel: {
    summary: 'Cancel an invitation',
    description:
      'Cancel a pending invitation. Group owner only. Cannot cancel already accepted invitations.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Invitation cancelled',
        example: { message: 'Invitation cancelled' },
      },
      { status: 400, description: 'Cannot cancel accepted invitation' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  resend: {
    summary: 'Resend invitation email',
    description:
      'Resend the invitation email with a new token. Group owner only. Extends expiry by 7 days.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Invitation resent',
        example: { message: 'Invitation resent' },
      },
      { status: 400, description: 'Cannot resend accepted invitation' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  getGroupInvitations: {
    summary: 'List group invitations (paginated)',
    description:
      'List all invitations sent for a group. Requires group membership. Accepts ?page=1&limit=20 query params.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Group invitations listed',
        example: {
          items: [
            {
              id: 'invitation-uuid',
              email: 'user@example.com',
              role: { name: 'USER', displayName: 'User' },
              expiresAt: '2026-02-22T00:00:00.000Z',
              acceptedAt: null,
              declinedAt: null,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,
};
