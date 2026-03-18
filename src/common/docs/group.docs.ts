/**
 * API Documentation for Group endpoints
 * Centralized location for all group-related Swagger documentation
 */

import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

export const GroupDocs = {
  // -- Discovery (public) --

  discoverGroups: {
    summary: 'Discover public groups',
    description:
      'Browse and search public groups. No authentication required. ' +
      'Supports filtering by tags (?tags=hiit,yoga), city, country, and free-text search on name/description (?search=yoga). ' +
      'Results sorted by member count (most popular first).',
    auth: false,
    responses: [
      {
        status: 200,
        description: 'Groups found',
        example: {
          items: [
            {
              id: '550e8400-e29b-41d4-a716-446655440000',
              name: 'Morning HIIT Crew',
              slug: 'morning-hiit-crew',
              description: 'High-intensity interval training every weekday morning',
              logoUrl: 'https://res.cloudinary.com/...',
              tags: ['fitness', 'hiit', 'morning'],
              joinPolicy: 'OPEN',
              city: 'Bucharest',
              country: 'RO',
              memberCount: 42,
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        },
      },
    ],
  } as ApiEndpointOptions,

  getPublicProfile: {
    summary: 'Get public group profile',
    description:
      'Returns the public profile of a group including instructor info, ' +
      'specializations, and upcoming sessions. No authentication required. ' +
      'Only works for public groups.',
    auth: false,
    responses: [
      {
        status: 200,
        description: 'Public profile retrieved',
        example: {
          group: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            name: 'Morning HIIT Crew',
            slug: 'morning-hiit-crew',
            tags: ['fitness', 'hiit'],
            joinPolicy: 'OPEN',
            city: 'Bucharest',
            memberCount: 42,
          },
          instructor: {
            firstName: 'John',
            lastName: 'Doe',
            displayName: 'Coach John',
            specializations: ['hiit', 'strength'],
            yearsOfExperience: 8,
          },
          upcomingSessions: [
            {
              id: 'session-uuid',
              title: 'Morning HIIT',
              scheduledAt: '2026-02-20T08:00:00.000Z',
              durationMinutes: 45,
              maxParticipants: 12,
              price: 50,
              currency: 'RON',
            },
          ],
        },
      },
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  selfJoin: {
    summary: 'Join a group',
    description:
      'Self-join a public group. Only works if the group is public and its joinPolicy is OPEN. ' +
      'For INVITE_ONLY groups, the user needs an invitation or join link.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Joined successfully',
        example: { message: 'You have joined the group' },
      },
      {
        status: 400,
        description: 'Already a member',
      },
      {
        status: 403,
        description:
          'Group is not public or join policy requires invitation/approval',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  // -- CRUD (authenticated) --

  create: {
    summary: 'Create a new group',
    description:
      'Create a new group. Requires INSTRUCTOR role. Creator becomes the owner. ' +
      'You can set tags, isPublic, joinPolicy, and contact/location info.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Group created successfully',
        example: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Morning HIIT Crew',
          slug: 'morning-hiit-crew',
          description: 'High-intensity interval training every weekday morning',
          tags: ['fitness', 'hiit'],
          isPublic: true,
          joinPolicy: 'OPEN',
          timezone: 'Europe/Bucharest',
          isActive: true,
        },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  getMyGroups: {
    summary: 'List my groups',
    description: 'Returns all groups the authenticated user belongs to.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Groups listed',
        example: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            name: 'Morning HIIT Crew',
            slug: 'morning-hiit-crew',
            tags: ['fitness', 'hiit'],
          },
        ],
      },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  getById: {
    summary: 'Get group by ID',
    description: 'Returns group details. User must be a member.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Group details retrieved',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  update: {
    summary: 'Update group',
    description:
      'Update group details. Owner only. If name changes, slug is auto-regenerated. ' +
      'You can also update tags, isPublic, joinPolicy, contact info, and location.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Group updated',
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  getMembers: {
    summary: 'List group members (paginated)',
    description:
      'Returns paginated members list with an isClient flag indicating whether each member ' +
      'is a client of the group instructor. Accepts ?page=1&limit=20 query params.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Members listed',
        example: {
          items: [
            {
              id: 'member-uuid',
              userId: 'user-uuid',
              firstName: 'Jane',
              lastName: 'Doe',
              avatarId: 'cloudinary-asset-id-or-null',
              isOwner: false,
              sharedHealthInfo: true,
              isClient: true,
              joinedAt: '2026-01-15T10:00:00.000Z',
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

  updateMyMembership: {
    summary: 'Update my membership settings',
    description:
      'Update your own membership in this group (e.g., share/hide health data, set nickname).',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Membership updated',
        example: {
          id: 'member-uuid',
          sharedHealthInfo: true,
          nickname: 'Johnny',
        },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  leaveGroup: {
    summary: 'Leave group',
    description:
      'Voluntarily leave a group. Owners cannot leave -- they must delete the group or transfer ownership.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Left group',
        example: { message: 'You have left the group' },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  removeMember: {
    summary: 'Remove a member',
    description:
      'Remove a member from the group. Owner only. Cannot remove the owner.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Member removed',
        example: { message: 'Member removed successfully' },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  deleteGroup: {
    summary: 'Delete group',
    description:
      'Soft-delete a group. Owner only. All members are effectively removed.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Group deleted',
        example: { message: 'Group deleted successfully' },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  // -- Join link management --

  generateJoinLink: {
    summary: 'Generate join link',
    description:
      'Generate a secure join link for the group. INSTRUCTOR role + owner only. ' +
      'The token expires in 7 days by default. Share the returned token in a URL ' +
      'like /groups/join/:token.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Join link generated',
        example: {
          message: 'Join link generated successfully',
          token: 'a1b2c3d4e5f6...',
          expiresAt: '2026-02-22T12:00:00.000Z',
        },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  revokeJoinLink: {
    summary: 'Revoke join link',
    description:
      'Revoke the current join link for the group. INSTRUCTOR role + owner only. ' +
      'After revoking, any previously shared links become invalid.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Join link revoked',
        example: { message: 'Join link revoked successfully' },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  joinViaLink: {
    summary: 'Join group via invite link',
    description:
      'Join a group using a shared invite link token. The token must be valid and not expired. ' +
      'Any authenticated user can use a valid link.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Joined successfully',
        example: { message: 'You have joined the group' },
      },
      {
        status: 400,
        description: 'Token expired or already a member',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,
};
