import { applyDecorators, Type } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from '@nestjs/swagger';

/**
 * Swagger Decorator Helpers
 *
 * These are "meta-decorators" that combine multiple Swagger decorators.
 * Benefits:
 * - Keep controllers clean and readable
 * - Ensure consistent documentation across endpoints
 * - Easy to update documentation in one place
 *
 * Think of decorators as "annotations" that add metadata to your code.
 * They don't change behavior, just add information for Swagger docs.
 */

export interface ApiEndpointOptions {
  summary: string;
  description?: string;
  auth?: boolean;
  body?: Type<unknown>;
  responses?: {
    status: number;
    description: string;
    example?: unknown;
  }[];
}

/**
 * Unified API Endpoint Decorator
 *
 * Usage:
 * @ApiEndpoint({
 *   summary: 'Get user profile',
 *   auth: true,
 *   responses: [...]
 * })
 */
export function ApiEndpoint(options: ApiEndpointOptions) {
  const decorators = [
    ApiOperation({
      summary: options.summary,
      description: options.description,
    }),
  ];

  // Add auth decorator if endpoint requires authentication
  if (options.auth) {
    decorators.push(ApiBearerAuth('JWT-auth'));
  }

  // Add request body documentation if provided
  if (options.body) {
    decorators.push(ApiBody({ type: options.body }));
  }

  // Add response documentation
  if (options.responses) {
    options.responses.forEach((response) => {
      decorators.push(
        ApiResponse({
          status: response.status,
          description: response.description,
          ...(response.example !== undefined && {
            schema: { example: response.example },
          }),
        }),
      );
    });
  }

  return applyDecorators(...decorators);
}

// Re-export standard responses for convenience
export { ApiStandardResponses } from '../docs/standard-responses';
