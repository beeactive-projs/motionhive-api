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
import {
  ErrorKey,
  isApiErrorBody,
  renderApiError,
  requestLocale,
  translate,
} from '../i18n';

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
/** `req.user` once the JWT guard has run; absent on public routes. */
type RequestWithUser = Request & { user?: { language?: string | null } };

/** Body fields the filter builds itself, or keeps from the client. */
const RESERVED_BODY_FIELDS = new Set([
  'statusCode',
  'message',
  'messageKey',
  'messageParams',
  'details',
  'error',
  'requestId',
  'timestamp',
  'path',
]);

/** Nest's default status texts, and our sentence for each. */
const GENERIC_BY_STATUS_TEXT: Record<string, ErrorKey> = {
  'Bad Request': 'common.badRequest',
  Unauthorized: 'common.unauthorized',
  Forbidden: 'common.forbidden',
  'Forbidden resource': 'common.forbidden',
  'Not Found': 'common.notFound',
  Conflict: 'common.conflict',
  'Payload Too Large': 'common.tooLarge',
  // Multer's own sentence when an upload passes `IMAGE_UPLOAD_OPTIONS`'
  // size limit.
  'File too large': 'common.tooLarge',
};

/**
 * Nest's own 404 for a route that does not exist: "Cannot GET /coach/…".
 * An app newer than the API it talks to asks for exactly these, and the
 * sentence is English with a path in it, so it is answered as a plain
 * not-found in the caller's language instead. The log keeps the original.
 */
const UNKNOWN_ROUTE = /^Cannot (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \//;

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
    /** Shown to the caller; `message` above stays English for the log. */
    let clientMessage: string | string[] | null = null;
    let details: string[] | undefined;
    /**
     * Machine-readable fields a thrower adds next to the message
     * (`code: 'ALREADY_BOOKED'`, `retryAfter: 42`). Passed through so
     * the apps can act on them; the message fields are handled above.
     */
    let extras: Record<string, unknown> = {};
    if (isHttpException) {
      const exceptionResponse: unknown = exception.getResponse();
      if (exceptionResponse && typeof exceptionResponse === 'object') {
        extras = Object.fromEntries(
          Object.entries(exceptionResponse).filter(
            ([key]) => !RESERVED_BODY_FIELDS.has(key),
          ),
        );
      }
      if (isApiErrorBody(exceptionResponse)) {
        // A catalog message: answer in the caller's language.
        message = exceptionResponse.message;
        clientMessage = renderApiError(
          exceptionResponse,
          requestLocale(request as RequestWithUser),
        );
        const raw = (exceptionResponse as { details?: unknown }).details;
        if (Array.isArray(raw)) details = raw as string[];
      } else if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (
        exceptionResponse &&
        typeof exceptionResponse === 'object' &&
        'message' in exceptionResponse
      ) {
        const raw = exceptionResponse.message;
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

    // A bare exception (`new NotFoundException()`) or a guard's refusal
    // carries Nest's English status text ("Not Found", "Unauthorized");
    // answer those with our own sentence, in the caller's language.
    if (clientMessage === null && typeof message === 'string') {
      const generic: ErrorKey | undefined =
        GENERIC_BY_STATUS_TEXT[message] ??
        (UNKNOWN_ROUTE.test(message) ? 'common.notFound' : undefined);
      if (generic) {
        clientMessage = translate(
          requestLocale(request as RequestWithUser),
          `errors.${generic}`,
        );
      }
    }

    // Build error response
    const errorResponse = {
      statusCode: status,
      ...extras,
      message: clientMessage ?? message,
      ...(details ? { details } : {}),
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
