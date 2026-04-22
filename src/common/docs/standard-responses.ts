/**
 * Standard API response definitions
 * Reusable response objects for common HTTP status codes
 */

export const ApiStandardResponses = {
  // 2xx Success
  OK: {
    status: 200,
    description: 'Request successful',
  },

  Created: {
    status: 201,
    description: 'Resource created successfully',
  },

  NoContent: {
    status: 204,
    description: 'Request successful, no content to return',
  },

  // 4xx Client Errors
  BadRequest: {
    status: 400,
    description: 'Invalid request data',
    example: {
      statusCode: 400,
      message: [
        'email must be an email',
        'password must be longer than 8 characters',
      ],
      error: 'Bad Request',
    },
  },

  Unauthorized: {
    status: 401,
    description: 'Authentication required or invalid credentials',
    example: {
      statusCode: 401,
      message: 'Unauthorized',
      error: 'Unauthorized',
    },
  },

  Forbidden: {
    status: 403,
    description: 'Insufficient permissions',
    example: {
      statusCode: 403,
      message: 'You do not have permission to access this resource',
      error: 'Forbidden',
    },
  },

  NotFound: {
    status: 404,
    description: 'Resource not found',
    example: {
      statusCode: 404,
      message: 'Resource not found',
      error: 'Not Found',
    },
  },

  Conflict: {
    status: 409,
    description: 'Resource conflict (e.g., duplicate entry)',
    example: {
      statusCode: 409,
      message: 'Resource already exists',
      error: 'Conflict',
    },
  },

  UnprocessableEntity: {
    status: 422,
    description: 'Validation failed',
    example: {
      statusCode: 422,
      message: 'Validation failed',
      error: 'Unprocessable Entity',
    },
  },

  TooManyRequests: {
    status: 429,
    description: 'Rate limit exceeded',
    example: {
      statusCode: 429,
      message: 'Too many requests, please try again later',
      error: 'Too Many Requests',
    },
  },

  // 5xx Server Errors
  InternalServerError: {
    status: 500,
    description: 'Internal server error',
    example: {
      statusCode: 500,
      message: 'Internal server error',
      error: 'Internal Server Error',
    },
  },

  ServiceUnavailable: {
    status: 503,
    description: 'Service temporarily unavailable',
    example: {
      statusCode: 503,
      message: 'Service temporarily unavailable',
      error: 'Service Unavailable',
    },
  },
};

/**
 * Shape of a single Swagger response config object.
 * Used by `createApiResponse` and `combineResponses`.
 */
export interface ApiResponseDescriptor {
  status: number;
  description: string;
  example?: unknown;
}

/**
 * Helper to create custom response objects
 */
export function createApiResponse(
  status: number,
  description: string,
  example?: unknown,
): ApiResponseDescriptor {
  return {
    status,
    description,
    ...(example !== undefined && { example }),
  };
}

/**
 * Combine multiple standard responses
 */
export function combineResponses(
  ...responses: ApiResponseDescriptor[]
): ApiResponseDescriptor[] {
  return responses;
}
