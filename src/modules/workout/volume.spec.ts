import {
  NO_VOLUME,
  VolumeUnit,
  changePercent,
  volumeIn,
  volumeOfSets,
  volumeTotalsFromRow,
  volumeUnitFor,
} from './volume';

/**
 * The one definition of volume: working sets only, and each exercise in
 * the unit it is actually done in. Pure, so it is pinned here once rather
 * than through every query that uses it.
 */
describe('volume', () => {
  const set = (fields: Record<string, unknown>) => ({
    isCompleted: true,
    setType: 'NORMAL',
    ...fields,
  });

  it('sums kg × reps over completed sets, leaving warm-ups out', () => {
    const totals = volumeOfSets([
      set({ setType: 'WARMUP', weightKg: 40, reps: 10 }),
      set({ weightKg: '62.50', reps: 8 }),
      set({ setType: 'DROPSET', weightKg: 50, reps: 10 }),
      set({ weightKg: 70, reps: 6, isCompleted: false }),
    ]);

    expect(totals).toEqual({ kg: 1000, reps: 18, seconds: 0, meters: 0 });
  });

  it('counts reps, seconds and metres where there is no weight', () => {
    expect(
      volumeOfSets([
        set({ reps: 15 }),
        set({ reps: 12 }),
        set({ durationSeconds: 45 }),
        set({ distanceMeters: 400 }),
      ]),
    ).toEqual({ kg: 0, reps: 27, seconds: 45, meters: 400 });
  });

  it.each([
    // The kind's own unit when its field is filled.
    ['STRENGTH', { kg: 1200, reps: 20 }, VolumeUnit.Kg],
    ['BODYWEIGHT', { reps: 40 }, VolumeUnit.Reps],
    ['DURATION', { seconds: 180 }, VolumeUnit.Seconds],
    ['MOBILITY', { seconds: 120 }, VolumeUnit.Seconds],
    ['DISTANCE', { meters: 1000, seconds: 300 }, VolumeUnit.Meters],
    ['CARDIO', { meters: 5000, seconds: 1500 }, VolumeUnit.Meters],
    // Then what the sets actually filled.
    ['STRENGTH', { reps: 30 }, VolumeUnit.Reps],
    ['STRENGTH', { meters: 40 }, VolumeUnit.Meters],
    ['CARDIO', { seconds: 900 }, VolumeUnit.Seconds],
    // Weighted pull-ups stay in reps: kg × reps leaves the body out.
    ['BODYWEIGHT', { kg: 200, reps: 20 }, VolumeUnit.Reps],
    // No catalog row: by the fields alone.
    [null, { reps: 12 }, VolumeUnit.Reps],
    [null, { kg: 500, reps: 10 }, VolumeUnit.Kg],
    // Nothing filled: the kind's unit.
    ['DURATION', {}, VolumeUnit.Seconds],
    [null, {}, VolumeUnit.Kg],
  ])('measures a %s exercise with %j in %s', (kind, filled, unit) => {
    expect(volumeUnitFor(kind, { ...NO_VOLUME, ...filled })).toBe(unit);
  });

  it('reads the totals in one unit, whole', () => {
    const totals = { kg: 1237.5, reps: 18, seconds: 95.4, meters: 0 };
    expect(volumeIn(VolumeUnit.Kg, totals)).toBe(1238);
    expect(volumeIn(VolumeUnit.Seconds, totals)).toBe(95);
  });

  it('reads the SQL sums back as numbers, missing ones as 0', () => {
    expect(
      volumeTotalsFromRow({ volumeKg: '1280.00', volumeReps: '24' }),
    ).toEqual({ kg: 1280, reps: 24, seconds: 0, meters: 0 });
  });

  it('gives the change in whole percent, and none without a base', () => {
    expect(changePercent(4280, 3940)).toBe(9);
    expect(changePercent(3600, 3940)).toBe(-9);
    expect(changePercent(100, 0)).toBeNull();
    expect(changePercent(100, null)).toBeNull();
  });
});
