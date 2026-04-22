import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { Request, Response } from 'express';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

/**
 * Global Exception Filter
 *
 * Catches ALL errors in the application and formats them consistently.
 * Benefits:
 * - Prevents sensitive error details from leaking to clients
 * - Logs all errors for debugging
 * - Returns user-friendly error messages
 * - Includes request ID for tracing
 *
 * Without this, some errors might expose:
 * - Database connection strings
 * - Internal file paths
 * - Stack traces
 * - Environment variables
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestId = request.requestId || 'unknown';

    // Determine if this is a known HTTP exception or an unexpected error
    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    // Get error message. NestJS's `getResponse()` can be a string or an
    // object like `{ statusCode, message }` — narrow via a type guard
    // rather than an `as any` cast so we can't accidentally read off a
    // string.
    let message: string | string[];
    if (isHttpException) {
      const exceptionResponse: unknown = exception.getResponse();
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        exceptionResponse &&
        typeof exceptionResponse === 'object' &&
        'message' in exceptionResponse
      ) {
        const raw = (exceptionResponse as { message: unknown }).message;
        message =
          typeof raw === 'string' || Array.isArray(raw)
            ? (raw as string | string[])
            : 'An error occurred';
      } else {
        message = 'An error occurred';
      }
    } else {
      message = 'Internal server error';
    }

    // Log the error (with full stack trace for unexpected errors)
    if (status >= 500) {
      // Server errors - log with full details
      this.logger.error(
        `[${requestId}] ${request.method} ${request.url} - ${status} - ${exception}`,
        exception instanceof Error ? exception.stack : '',
        'HttpExceptionFilter',
      );
    } else {
      // Client errors (4xx) - just log as warning
      this.logger.warn(
        `[${requestId}] ${request.method} ${request.url} - ${status} - ${message}`,
        'HttpExceptionFilter',
      );
    }

    // Build error response
    const errorResponse = {
      statusCode: status,
      message,
      error: isHttpException
        ? exception.constructor.name
        : 'InternalServerError',
      requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    response.status(status).json(errorResponse);
  }
}
