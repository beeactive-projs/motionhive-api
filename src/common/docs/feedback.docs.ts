import { ApiEndpointOptions } from '../decorators/api-response.decorator';
import { ApiStandardResponses } from './standard-responses';

export const FeedbackDocs = {
  create: {
    summary: 'Submit feedback',
    description:
      'Submit a bug report, suggestion, or other feedback. ' +
      'No authentication required. Authenticated users can include their userId.',
    auth: false,
    responses: [
      {
        status: 201,
        description: 'Feedback submitted',
        example: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          type: 'bug',
          title: 'Login button not working',
          message: 'When I click the login button on mobile, nothing happens.',
          userId: null,
          email: 'user@example.com',
          createdAt: '2026-03-16T10:00:00.000Z',
        },
      },
      ApiStandardResponses.BadRequest,
    ],
  } as ApiEndpointOptions,

  list: {
    summary: 'List all feedback',
    description:
      'Returns all feedback entries ordered by most recent. Requires ADMIN or SUPER_ADMIN role.',
    auth: true,
    responses: [
      {
        status: 200,
        description: 'Feedback list retrieved',
      },
      ApiStandardResponses.Unauthorized,
      ApiStandardResponses.Forbidden,
    ],
  } as ApiEndpointOptions,
};
