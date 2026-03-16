import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

export const WaitlistDocs = {
  create: {
    summary: 'Join the waitlist',
    description:
      'Add an email to the BeeActive waitlist. No authentication required. ' +
      'Optionally include name, role (leader/participant), and signup source.',
    auth: false,
    responses: [
      {
        status: 201,
        description: 'Added to waitlist',
        example: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          email: 'john@example.com',
          name: 'John Doe',
          role: 'leader',
          source: 'homepage',
          createdAt: '2026-03-16T10:00:00.000Z',
        },
      },
      ApiStandardResponses.BadRequest,
      ApiStandardResponses.Conflict,
    ],
  } as ApiEndpointOptions,

  list: {
    summary: 'List all waitlist entries',
    description: 'Returns all waitlist entries ordered by most recent. Requires ADMIN or SUPER_ADMIN role.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Waitlist entries retrieved',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,

  count: {
    summary: 'Get waitlist count',
    description: 'Returns the total number of people on the waitlist. No authentication required.',
    auth: false,
    responses: [
      {
        status: 200,
        description: 'Waitlist count',
        example: { total: 42 },
      },
    ],
  } as ApiEndpointOptions,
};
