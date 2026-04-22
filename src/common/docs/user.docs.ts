/**
 * API Documentation for User endpoints
 */

import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

export const UserDocs = {
  getProfile: {
    summary: 'Get current user profile',
    description: 'Returns the profile of the currently authenticated user.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'User profile retrieved',
        example: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          email: 'user@example.com',
          firstName: 'John',
          lastName: 'Doe',
          phone: '+40123456789',
          avatarId: 1,
          language: 'en',
          timezone: 'Europe/Bucharest',
          isActive: true,
          isEmailVerified: false,
          roles: ['USER', 'INSTRUCTOR'],
          createdAt: '2024-01-15T10:30:00.000Z',
        },
      },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  updateProfile: {
    summary: 'Update user profile',
    description:
      'Update core user fields (name, phone, avatar, language, timezone). Email change not supported here.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Profile updated',
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  deleteAccount: {
    summary: 'Delete account (GDPR)',
    description:
      'Soft-delete your account. Account is deactivated and data is preserved for the legally required retention period.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Account deleted',
        example: { message: 'Account deleted successfully' },
      },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,
};
