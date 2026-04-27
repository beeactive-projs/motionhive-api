import { ForbiddenException, NotFoundException } from '@nestjs/common';

export type OwnershipMismatchPolicy = 'forbid' | 'hide';

export interface AssertOwnedOptions {
  notFoundMessage?: string;
  forbiddenMessage?: string;
  /**
   * What to throw when the entity exists but the principal does not own it.
   * - `'forbid'` (default): throw ForbiddenException — the dominant shape.
   * - `'hide'`: throw NotFoundException — use when ownership leaks existence
   *   of resources owned by other users (e.g. venues across instructors).
   */
  onMismatch?: OwnershipMismatchPolicy;
}

/**
 * Assert that `entity` exists and that `principalId` is one of the
 * `allowedOwnerIds` taken from the entity.
 *
 * Replaces the open-coded `if (!x) throw NotFound; if (x.ownerId !== id) throw Forbidden`
 * pattern that was scattered across every owner-scoped service. The asserts
 * return type narrows `T | null` to `T` so the caller doesn't need a separate
 * null check after this call.
 *
 * The caller picks the owner field(s) off the entity — keeping the helper
 * agnostic to the shape. For multi-owner resources (e.g. an invoice owned
 * by either the instructor or the client) pass an array of allowed IDs.
 *
 * @example
 *   const venue = await this.venueModel.findByPk(id);
 *   assertOwned(venue, instructorId, (v) => v.instructorId, {
 *     notFoundMessage: 'Venue not found.',
 *     onMismatch: 'hide',  // don't leak cross-instructor existence
 *   });
 *   // venue is now narrowed to Venue (non-null)
 *
 * @example
 *   const invoice = await this.invoiceModel.findByPk(id);
 *   assertOwned(invoice, userId, (i) => [i.instructorId, i.clientId], {
 *     notFoundMessage: 'Invoice not found.',
 *     forbiddenMessage: 'You cannot access this invoice.',
 *   });
 */
export function assertOwned<T>(
  entity: T | null | undefined,
  principalId: string | null | undefined,
  getOwners: (
    entity: T,
  ) => string | null | undefined | readonly (string | null | undefined)[],
  opts: AssertOwnedOptions = {},
): asserts entity is T {
  const {
    notFoundMessage = 'Resource not found.',
    forbiddenMessage = 'You do not own this resource.',
    onMismatch = 'forbid',
  } = opts;

  if (!entity) {
    throw new NotFoundException(notFoundMessage);
  }

  // Missing principal = unauthenticated caller slipped past the guard.
  // Fail closed.
  if (!principalId) {
    throw new ForbiddenException(forbiddenMessage);
  }

  const ownersRaw = getOwners(entity);
  const owners = Array.isArray(ownersRaw) ? ownersRaw : [ownersRaw];
  const ownerMatches = owners.some(
    (ownerId) => ownerId != null && ownerId === principalId,
  );

  if (!ownerMatches) {
    if (onMismatch === 'hide') {
      throw new NotFoundException(notFoundMessage);
    }
    throw new ForbiddenException(forbiddenMessage);
  }
}
