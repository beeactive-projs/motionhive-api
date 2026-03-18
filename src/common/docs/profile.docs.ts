/**
 * API Documentation for Profile endpoints
 * Centralized location for all profile-related Swagger documentation
 */

import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

export const ProfileDocs = {
  discoverTrainers: {
    summary: 'Discover instructors',
    description:
      'Browse and search public instructor profiles. No authentication required. ' +
      'Supports search by name, display name, first/last name, bio, specializations, and city. ' +
      'Filter by city or country using separate query params. ' +
      'Returns up to 30 results sorted by years of experience (most experienced first). ' +
      'Query params: search (string), city (string), country (ISO 3166-1 alpha-2 e.g. "RO").',
    auth: false,
    responses: [
      {
        status: 200,
        description: 'List of matching public instructor profiles (plain array, max 30)',
        example: [
          {
            id: 'profile-uuid',
            userId: 'user-uuid',
            firstName: 'John',
            lastName: 'Doe',
            avatarId: 'cloudinary-asset-id-or-null',
            displayName: 'Coach John',
            bio: 'Certified HIIT and strength trainer with 8 years experience',
            specializations: ['hiit', 'strength', 'weight_loss'],
            yearsOfExperience: 8,
            isAcceptingClients: true,
            city: 'Bucharest',
            country: 'RO',
            socialLinks: {
              instagram: 'https://instagram.com/coachjohn',
              website: 'https://coachjohn.com',
            },
          },
        ],
      },
    ],
  } as ApiEndpointOptions,

  getInstructorPublicProfile: {
    summary: 'Get public instructor profile',
    description:
      "Returns a specific instructor's public profile by user ID. " +
      'Only returns data if the instructor has set isPublic to true. ' +
      'No authentication required. ' +
      'socialLinks is null when the instructor has showSocialLinks=false.',
    auth: false,
    responses: [
      {
        status: 200,
        description: 'Instructor public profile retrieved',
        example: {
          id: 'profile-uuid',
          userId: 'user-uuid',
          firstName: 'John',
          lastName: 'Doe',
          avatarId: 'cloudinary-asset-id-or-null',
          displayName: 'Coach John',
          bio: 'Certified HIIT and strength trainer',
          specializations: ['hiit', 'strength'],
          certifications: [
            { name: 'ACE Personal Trainer', year: 2018 },
          ],
          yearsOfExperience: 8,
          isAcceptingClients: true,
          city: 'Bucharest',
          country: 'RO',
          socialLinks: {
            instagram: 'https://instagram.com/coachjohn',
            website: 'https://coachjohn.com',
          },
          showEmail: true,
          showPhone: false,
        },
      },
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  getProfileOverview: {
    summary: 'Get full profile overview',
    description:
      'Returns user data, roles, and both profiles. Use this on app load to determine what UI to show.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Profile overview retrieved',
        example: {
          user: {
            id: '550e8400-e29b-41d4-a716-446655440000',
            email: 'user@example.com',
            firstName: 'John',
            lastName: 'Doe',
          },
          roles: ['USER'],
          hasInstructorProfile: false,
          userProfile: {
            fitnessLevel: 'INTERMEDIATE',
            goals: ['weight_loss'],
          },
          instructorProfile: null,
        },
      },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  getParticipantProfile: {
    summary: 'Get user profile',
    description: "Returns the authenticated user's profile data.",
    auth: true,
    responses: [
      {
        status: 200,
        description: 'User profile retrieved',
        example: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          fitnessLevel: 'INTERMEDIATE',
          goals: ['weight_loss', 'muscle_gain'],
          dateOfBirth: '1990-05-15',
          gender: 'MALE',
          heightCm: 180.5,
          weightKg: 75.0,
        },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  updateParticipantProfile: {
    summary: 'Update user profile',
    description:
      'Update health & fitness data. All fields are optional — fill them progressively.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'User profile updated',
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  getOrganizerProfile: {
    summary: 'Get instructor profile',
    description: "Returns the authenticated user's instructor profile.",
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Instructor profile retrieved',
        example: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          displayName: 'Coach John',
          bio: 'Certified trainer',
          specializations: ['hiit', 'yoga'],
          yearsOfExperience: 5,
        },
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  updateOrganizerProfile: {
    summary: 'Update instructor profile',
    description:
      'Update professional data. All fields optional — fill progressively.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Instructor profile updated',
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  updateFullProfile: {
    summary: 'Update full profile (unified)',
    description:
      'Update user + user profile + instructor profiles in a single API call. Only provided sections are updated. Pass { user: {...}, userProfile: {...}, instructor: {...} }.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Profile sections updated',
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  createOrganizerProfile: {
    summary: 'Activate instructor profile',
    description:
      'Creates an instructor profile and assigns the INSTRUCTOR role. This is the "I want to be an instructor" action.',
    auth: true,
    responses: [
      {
        status: 201,
        description: 'Instructor profile created and INSTRUCTOR role assigned',
        example: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          displayName: 'Coach John',
          userId: '550e8400-e29b-41d4-a716-446655440001',
        },
      },
      { status: 409, description: 'Instructor profile already exists' },
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,
};
