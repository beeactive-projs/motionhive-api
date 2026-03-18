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
      'Invite someone to join your group. Owner only. Returns an invitationLink for testing. Sends email when provider is configured.',
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
          invitationLink:
            'http://localhost:4200/accept-invitation?token=abc123...',
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
      "Returns paginated pending invitations for the authenticated user's email. Accepts ?page=1&limit=20 query params.",
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Pending invitations listed',
        example: {
          items: [
            {
              id: 'invitation-uuid',
              inviter: { firstName: 'Sarah', lastName: 'Johnson' },
              group: { name: "Sarah's Fitness Group" },
              role: { displayName: 'User' },
              message: 'Join my fitness group!',
              expiresAt: '2026-02-22T00:00:00.000Z',
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
