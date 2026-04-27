import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { assertOwned } from './ownership.utils';

interface OwnedEntity {
  id: string;
  instructorId: string;
}

interface DualOwnedEntity {
  id: string;
  instructorId: string;
  clientId: string | null;
}

describe('assertOwned', () => {
  const principal = 'user-1';
  const owned: OwnedEntity = { id: 'e-1', instructorId: principal };
  const notOwned: OwnedEntity = { id: 'e-2', instructorId: 'user-2' };

  it('passes when the principal owns the entity', () => {
    expect(() =>
      assertOwned(owned, principal, (e) => e.instructorId),
    ).not.toThrow();
  });

  it('throws NotFoundException with the configured message when the entity is null', () => {
    expect(() =>
      assertOwned<OwnedEntity>(null, principal, (e) => e.instructorId, {
        notFoundMessage: 'Venue not found.',
      }),
    ).toThrow(new NotFoundException('Venue not found.'));
  });

  it('throws NotFoundException when the entity is undefined', () => {
    expect(() =>
      assertOwned<OwnedEntity>(undefined, principal, (e) => e.instructorId),
    ).toThrow(NotFoundException);
  });

  it('throws ForbiddenException when the principal does not match (default policy)', () => {
    expect(() =>
      assertOwned(notOwned, principal, (e) => e.instructorId, {
        forbiddenMessage: 'You do not own this venue.',
      }),
    ).toThrow(new ForbiddenException('You do not own this venue.'));
  });

  it('throws NotFoundException on mismatch when policy is "hide"', () => {
    expect(() =>
      assertOwned(notOwned, principal, (e) => e.instructorId, {
        notFoundMessage: 'Venue not found.',
        onMismatch: 'hide',
      }),
    ).toThrow(new NotFoundException('Venue not found.'));
  });

  it('fails closed (Forbidden) when principalId is missing', () => {
    expect(() => assertOwned(owned, undefined, (e) => e.instructorId)).toThrow(
      ForbiddenException,
    );
    expect(() => assertOwned(owned, null, (e) => e.instructorId)).toThrow(
      ForbiddenException,
    );
    expect(() => assertOwned(owned, '', (e) => e.instructorId)).toThrow(
      ForbiddenException,
    );
  });

  it('fails closed (Forbidden) on missing principal even when policy is "hide"', () => {
    // A missing principal is a programmer error / auth gap, not a permissions
    // probe — so even resources that normally hide existence should not let
    // the call slip through silently.
    expect(() =>
      assertOwned(owned, undefined, (e) => e.instructorId, {
        onMismatch: 'hide',
      }),
    ).toThrow(ForbiddenException);
  });

  it('supports multi-owner resources via an array of owner IDs', () => {
    const invoice: DualOwnedEntity = {
      id: 'inv-1',
      instructorId: 'user-2',
      clientId: principal,
    };
    expect(() =>
      assertOwned(invoice, principal, (i) => [i.instructorId, i.clientId]),
    ).not.toThrow();
  });

  it('throws when neither owner in a multi-owner array matches', () => {
    const invoice: DualOwnedEntity = {
      id: 'inv-1',
      instructorId: 'user-2',
      clientId: 'user-3',
    };
    expect(() =>
      assertOwned(invoice, principal, (i) => [i.instructorId, i.clientId]),
    ).toThrow(ForbiddenException);
  });

  it('ignores null owner fields in a multi-owner array', () => {
    // A null clientId on a draft invoice must not coincidentally match a
    // null/empty principal — but that is already covered by the principal
    // check. Here we verify a null in the owner list does not throw or match.
    const invoice: DualOwnedEntity = {
      id: 'inv-1',
      instructorId: principal,
      clientId: null,
    };
    expect(() =>
      assertOwned(invoice, principal, (i) => [i.instructorId, i.clientId]),
    ).not.toThrow();
  });

  it('narrows the entity type for the caller (compile-time check)', () => {
    const venue: OwnedEntity | null = owned;
    assertOwned(venue, principal, (v) => v.instructorId);
    // After the assert, `venue` is non-null — direct field access compiles.
    const id: string = venue.id;
    expect(id).toBe('e-1');
  });

  it('uses default messages when none are provided', () => {
    let caught: NotFoundException | undefined;
    try {
      assertOwned<OwnedEntity>(null, principal, (e) => e.instructorId);
    } catch (e) {
      caught = e as NotFoundException;
    }
    expect(caught).toBeInstanceOf(NotFoundException);
    expect(caught?.message).toBe('Resource not found.');

    let forbidden: ForbiddenException | undefined;
    try {
      assertOwned(notOwned, principal, (e) => e.instructorId);
    } catch (e) {
      forbidden = e as ForbiddenException;
    }
    expect(forbidden).toBeInstanceOf(ForbiddenException);
    expect(forbidden?.message).toBe('You do not own this resource.');
  });
});
