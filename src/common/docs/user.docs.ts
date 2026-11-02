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

  getWorkoutSettings: {
    summary: 'My workout settings',
    description:
      'Settings › Workouts: every key, with its default when the person ' +
      'never changed it. `defaultRestSeconds` (15 to 600, default 90) is ' +
      'the rest when nothing more specific is planned; the switches ' +
      'default to on, except `askEffort` (off).',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Settings, every key resolved',
        example: {
          defaultRestSeconds: 90,
          sound: true,
          vibration: true,
          lockScreen: true,
          askEffort: false,
          supersetJump: true,
          keepScreenOn: true,
        },
      },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  updateWorkoutSettings: {
    summary: 'Change my workout settings',
    description:
      'Any subset of the keys; the rest keep their value, and a key sent ' +
      'as null goes back to its default. Answers with every key resolved, ' +
      'like the GET.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Settings after the change, every key resolved',
        example: {
          defaultRestSeconds: 120,
          sound: false,
          vibration: true,
          lockScreen: true,
          askEffort: false,
          supersetJump: true,
          keepScreenOn: true,
        },
      },
      ApiStandardResponses.BadRequest,
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
};
