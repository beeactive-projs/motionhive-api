import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

const venueExample = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  instructorId: '7b2c1f3a-6e9d-4a0b-9c12-8d5e4f3a2b1c',
  kind: 'GYM',
  isOnline: false,
  name: 'FitZone Cluj — Downtown',
  notes: 'Meet at the main entrance.',
  line1: 'Str. Memorandumului 28',
  line2: null,
  city: 'Cluj-Napoca',
  region: 'Cluj',
  postalCode: '400114',
  countryCode: 'RO',
  latitude: 46.7712,
  longitude: 23.6236,
  meetingUrl: null,
  meetingProvider: null,
  travelRadiusKm: null,
  isActive: true,
  displayOrder: 1,
  createdAt: '2026-04-24T09:00:00.000Z',
  updatedAt: '2026-04-24T09:00:00.000Z',
};

export const VenueDocs = {
  list: {
    summary: "List the authenticated instructor's venues",
    description:
      'Returns the instructor catalogue of venues (active and archived). ' +
      'Ordered by `displayOrder` ascending, then by creation time descending.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Venues returned',
        example: [venueExample],
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  get: {
    summary: 'Get one venue by id',
    description:
      'Only venues owned by the authenticated instructor are returned; ' +
      'any other id responds with 404 (deliberately — we do not leak ' +
      'existence of other instructors venues).',
    auth: true,
    responses: [
      { status: 200, description: 'Venue returned', example: venueExample },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  create: {
    summary: 'Create a venue',
    description:
      'Creates a new venue owned by the authenticated instructor. ' +
      '`kind=ONLINE` requires `meetingUrl`. Physical kinds (GYM/STUDIO/' +
      'PARK/OUTDOOR/OTHER) require at least `city`. `CLIENT_HOME` stores ' +
      'no address — the client address belongs to the booking.',
    auth: true,
    responses: [
      { status: 201, description: 'Venue created', example: venueExample },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  update: {
    summary: 'Update a venue',
    description:
      'Partial update — only the provided fields change. Cross-field ' +
      'rules are re-validated against the post-update snapshot, so a ' +
      'switch from GYM to ONLINE requires `meetingUrl`.',
    auth: true,
    responses: [
      { status: 200, description: 'Venue updated', example: venueExample },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  archive: {
    summary: 'Archive a venue (soft disable)',
    description:
      'Sets `isActive=false`. Archived venues are hidden from new-session ' +
      'pickers but still resolvable for historical sessions that reference ' +
      'them. Reversible via update with `isActive=true`.',
    auth: true,
    responses: [
      { status: 204, description: 'Venue archived' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,

  remove: {
    summary: 'Delete a venue (soft delete)',
    description:
      'Paranoid delete — sets `deletedAt`. Sessions that reference the ' +
      'venue keep their FK via the DB-level ON DELETE SET NULL (only ' +
      'triggered by hard delete, which this endpoint does not do).',
    auth: true,
    responses: [
      { status: 204, description: 'Venue deleted' },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.NotFound,
    ],
  } as ApiEndpointOptions,
};
