import { NotFoundException, ParseUUIDPipe } from '@nestjs/common';
import { apiError } from '../i18n';

/**
 * `ParseUUIDPipe` that answers 404 instead of 400.
 *
 * For a catch-all `:id` route sitting under a collection, a path segment that
 * is not a UUID is not a malformed request — it is a URL that does not exist.
 * `GET /clients/requests` answered
 * `400 "Validation failed (uuid is expected)"`, which reads as "your uuid is
 * wrong" when the caller never meant to send one: they guessed a sub-resource
 * that isn't there, and the `:clientId` route swallowed it.
 *
 * Use this ONLY on the wildcard param of a catch-all route. On a param under
 * a literal prefix (`/clients/requests/:requestId/accept`) the caller clearly
 * did mean to pass an id, so a plain `ParseUUIDPipe` and its 400 is right.
 */
export function parseUuidOrNotFound(): ParseUUIDPipe {
  return new ParseUUIDPipe({
    exceptionFactory: () => new NotFoundException(apiError('common.notFound')),
  });
}
