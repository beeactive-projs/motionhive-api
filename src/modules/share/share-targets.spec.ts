import { SHARE_TARGETS } from './share-targets';

/**
 * Each type's "public" rule, pinned against the rule its own module uses:
 * session access OPEN (session.enums `SessionAccess`), a public active group
 * (group `isPublic`), a public coach profile (instructor_profile
 * `is_public`), a SYSTEM or PUBLIC exercise (exercise `ExerciseVisibility`),
 * a MotionHive starter (program `source = 'SYSTEM'`, no owner).
 */
describe('share targets', () => {
  const now = new Date('2026-11-20T10:00:00Z');
  const later = '2026-11-21T09:00:00Z';
  const earlier = '2026-11-19T09:00:00Z';

  describe('SESSION', () => {
    const open = {
      id: 's-1',
      name: 'Morning yoga flow',
      startAt: '2026-11-21T08:00:00Z',
      endAt: later,
      status: 'SCHEDULED',
      seriesStatus: 'ACTIVE',
      access: 'OPEN',
      durationMinutes: 60,
      timezone: 'Europe/Bucharest',
      locationKind: 'IN_PERSON',
      capacity: 12,
      confirmedCount: '8',
      priceCents: null,
      currency: null,
      placeName: 'Herăstrău',
      placeCity: 'București',
    };

    it('an open, upcoming occurrence is available with its seats and place', () => {
      expect(SHARE_TARGETS.SESSION.toCard(open, now)).toMatchObject({
        state: 'AVAILABLE',
        name: 'Morning yoga flow',
        capacity: 12,
        confirmedCount: 8,
        placeName: 'Herăstrău',
      });
    });

    it('is ended once over', () => {
      expect(
        SHARE_TARGETS.SESSION.toCard({ ...open, endAt: earlier }, now).state,
      ).toBe('ENDED');
    });

    it('members-only, clients-only and cancelled ones are unavailable, with no details', () => {
      for (const row of [
        { ...open, access: 'GROUP_ONLY' },
        { ...open, access: 'CLIENTS_ONLY' },
        { ...open, status: 'CANCELLED' },
        { ...open, seriesStatus: 'CANCELLED' },
      ]) {
        expect(SHARE_TARGETS.SESSION.toCard(row, now)).toEqual({
          type: 'SESSION',
          state: 'UNAVAILABLE',
          name: null,
        });
      }
    });

    it('an online session shows no place', () => {
      const card = SHARE_TARGETS.SESSION.toCard(
        { ...open, locationKind: 'ONLINE' },
        now,
      );
      expect(card).toMatchObject({
        online: true,
        placeName: null,
        placeCity: null,
      });
    });

    it('never selects an address or a meeting link', () => {
      expect(SHARE_TARGETS.SESSION.sql).not.toMatch(
        /meeting_url|line1|line2|postal/,
      );
    });
  });

  it('GROUP: public and active only', () => {
    const row = {
      id: 'g',
      name: 'Runners',
      isPublic: true,
      isActive: true,
      memberCount: '3',
    };
    expect(SHARE_TARGETS.GROUP.toCard(row, now)).toMatchObject({
      state: 'AVAILABLE',
      memberCount: 3,
    });
    expect(
      SHARE_TARGETS.GROUP.toCard({ ...row, isPublic: false }, now).state,
    ).toBe('UNAVAILABLE');
    expect(
      SHARE_TARGETS.GROUP.toCard({ ...row, isActive: false }, now).state,
    ).toBe('UNAVAILABLE');
  });

  it('COACH: a public coach profile only; the city only when shown to everyone', () => {
    const row = {
      id: 'u',
      firstName: 'Ana',
      lastName: 'Niță',
      isPublic: true,
      takingClients: true,
      city: null,
      categoryIds: ['c-1 '],
    };
    expect(SHARE_TARGETS.COACH.toCard(row, now)).toMatchObject({
      state: 'AVAILABLE',
      name: 'Ana Niță',
      city: null,
      categoryIds: ['c-1'],
    });
    expect(SHARE_TARGETS.COACH.sql).toContain("privacy_settings->>'city'");
    expect(
      SHARE_TARGETS.COACH.toCard({ ...row, isPublic: false }, now).state,
    ).toBe('UNAVAILABLE');
  });

  it('EXERCISE: MotionHive own or public, with translations for the reader', () => {
    const row = {
      id: 'e',
      name: 'Squat',
      translations: { ro: { name: 'Genuflexiune' } },
      source: 'SYSTEM',
      visibility: 'PRIVATE',
      primaryMuscles: [{ commonName: 'Quadriceps', translations: null }],
    };
    expect(SHARE_TARGETS.EXERCISE.toCard(row, now)).toMatchObject({
      state: 'AVAILABLE',
      translations: { ro: { name: 'Genuflexiune' } },
    });
    expect(
      SHARE_TARGETS.EXERCISE.toCard(
        { ...row, source: 'INSTRUCTOR', visibility: 'PUBLIC' },
        now,
      ).state,
    ).toBe('AVAILABLE');
    expect(
      SHARE_TARGETS.EXERCISE.toCard(
        { ...row, source: 'INSTRUCTOR', visibility: 'PRIVATE' },
        now,
      ).state,
    ).toBe('UNAVAILABLE');
  });

  it('PROGRAM: MotionHive starters only', () => {
    const row = {
      id: 'p',
      name: 'Pull day',
      source: 'SYSTEM',
      ownerId: null,
      status: 'PUBLISHED',
      isSingleWorkout: true,
      workoutCount: '1',
    };
    expect(SHARE_TARGETS.PROGRAM.toCard(row, now)).toMatchObject({
      state: 'AVAILABLE',
      isSingleWorkout: true,
      workoutCount: 1,
    });
    expect(
      SHARE_TARGETS.PROGRAM.toCard({ ...row, ownerId: 'someone' }, now).state,
    ).toBe('UNAVAILABLE');
    expect(
      SHARE_TARGETS.PROGRAM.toCard({ ...row, source: 'INSTRUCTOR' }, now).state,
    ).toBe('UNAVAILABLE');
    expect(
      SHARE_TARGETS.PROGRAM.toCard({ ...row, status: 'ARCHIVED' }, now).state,
    ).toBe('UNAVAILABLE');
  });
});
