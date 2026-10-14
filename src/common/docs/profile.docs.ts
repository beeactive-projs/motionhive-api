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
        description:
          'List of matching public instructor profiles (plain array, max 30)',
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
          certifications: [{ name: 'ACE Personal Trainer', year: 2018 }],
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

  getInstructorPublicProfileByHandle: {
    summary: 'Get public instructor profile by handle',
    description:
      "Same as `GET /profile/instructors/:id` but looked up by the instructor's short handle (case-insensitive). " +
      'Powers the `/@<handle>` Public Profile page. Returns 404 when no instructor uses that handle. ' +
      'No authentication required.',
    auth: false,
    responses: [
      {
        status: 200,
        description: 'Instructor public profile retrieved',
        example: {
          id: 'profile-uuid',
          userId: 'user-uuid',
          handle: 'ionut',
          firstName: 'Ionut',
          lastName: 'Popescu',
          avatarId: 1,
          avatarUrl: null,
          displayName: 'Coach Ionut',
          bio: 'Certified HIIT and strength trainer',
          specializations: ['hiit', 'strength'],
          certifications: [{ name: 'ACE Personal Trainer', year: 2018 }],
          yearsOfExperience: 8,
          isAcceptingClients: true,
          city: 'Bucharest',
          countryCode: 'RO',
          socialLinks: {
            instagram: 'https://instagram.com/coach',
          },
          showEmail: true,
          showPhone: false,
          joinedAt: '2024-01-15T08:00:00.000Z',
          rating: { average: 4.9, total: 86 },
        },
      },
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  getInstructorPublicGroups: {
    summary: 'List public groups owned by an instructor',
    description:
      'Returns groups where the user is the owning instructor and the group is marked public. Powers the Groups tab of the Public Profile page. No authentication required.',
    auth: false,
    responses: [
      {
        status: 200,
        description: 'Array of public groups',
        example: [
          {
            id: 'group-uuid',
            name: 'Morning HIIT',
            slug: 'morning-hiit',
            description: 'Outdoor HIIT in Herastrau every weekday at 7am',
            logoUrl: null,
            city: 'Bucharest',
            country: 'RO',
            memberCount: 24,
          },
        ],
      },
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

  getPublicUserProfileByHandle: {
    summary: 'Get public profile by handle (any user)',
    description:
      'Resolves a `/@<handle>` profile for any user, not just instructors. ' +
      'Anonymous viewers receive the PUBLIC slice; signed-in viewers may see ' +
      'more — coaches connected to the profile owner see COACHES_ONLY fields, ' +
      'and the owner themselves sees every field. Returns the audience tier ' +
      'so the UI does not have to recompute it. Fields not visible to the ' +
      'viewer are returned as `null`. `sharedGroups` lists the groups a ' +
      'signed-in viewer and the owner are both active members of (empty for ' +
      'a guest or the owner).',
    auth: false,
    responses: [
      {
        status: 200,
        description: 'Public user profile retrieved',
        example: {
          userId: 'user-uuid',
          handle: 'jane-doe',
          audience: 'PUBLIC',
          firstName: 'Jane',
          lastName: 'Doe',
          avatarUrl: 'https://res.cloudinary.com/.../jane.jpg',
          email: null,
          phone: null,
          city: 'Cluj-Napoca',
          countryCode: 'RO',
          language: null,
          timezone: null,
          displayRoles: [],
          memberSince: '2024-08-12T10:00:00.000Z',
          isInstructor: false,
          sharedGroups: [
            { id: 'group-uuid', name: 'Morning Crew', logoUrl: null },
          ],
        },
      },
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  updatePrivacySettings: {
    summary: 'Update per-field profile privacy',
    description:
      'Patch one or more keys in `user.privacy_settings`. Body keys must be ' +
      'in {firstName, lastName, avatarUrl, email, phone, city, language, ' +
      'timezone}; values must be in {PUBLIC, COACHES_ONLY, ONLY_ME}. Missing ' +
      'keys are left untouched.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Privacy settings merged',
        example: {
          privacySettings: {
            email: 'PUBLIC',
            phone: 'COACHES_ONLY',
          },
        },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
    ],
  } as ApiEndpointOptions,

  updateHandle: {
    summary: 'Claim or rename the profile handle',
    description:
      'Sets `user.handle` (the URL slug used by `/@<handle>`). The handle is ' +
      'normalised to lowercase, must be 3-40 chars of letters, digits, "_" ' +
      'or "-", and must start and end with an alphanumeric. Uniqueness is ' +
      'case-insensitive.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Handle updated',
        example: { handle: 'jane-doe' },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      { status: 409, description: 'Handle already taken' },
    ],
  } as ApiEndpointOptions,
};
