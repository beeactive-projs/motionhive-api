import { ExerciseKind } from '../exercise/entities/exercise.enums';
import { ExerciseSetType } from './entities/workout.enums';

/**
 * Training volume, one definition for every surface that shows it (the
 * exercise history, the finished workout, the weekly totals).
 *
 * Volume is Σ weight × reps over the completed sets that are not warm-ups.
 * An exercise with no load is measured in what it does have: a bodyweight
 * movement in total reps, a hold in total seconds, a carry or a run in
 * total metres. The unit travels with the number, so "4,280" is never read
 * as reps or "120" as kilograms.
 */
export const VolumeUnit = {
  Kg: 'kg',
  Reps: 'reps',
  Seconds: 'seconds',
  Meters: 'meters',
} as const;
export type VolumeUnit = (typeof VolumeUnit)[keyof typeof VolumeUnit];

/** The four sums one set list can have, before a unit is chosen. */
export interface VolumeTotals {
  kg: number;
  reps: number;
  seconds: number;
  meters: number;
}

export const NO_VOLUME: VolumeTotals = {
  kg: 0,
  reps: 0,
  seconds: 0,
  meters: 0,
};

const TOTAL_OF: Record<VolumeUnit, keyof VolumeTotals> = {
  [VolumeUnit.Kg]: 'kg',
  [VolumeUnit.Reps]: 'reps',
  [VolumeUnit.Seconds]: 'seconds',
  [VolumeUnit.Meters]: 'meters',
};

/**
 * Which unit an exercise is measured in, most fitting first. The first one
 * the sets actually filled wins, so a strength exercise logged without a
 * weight still shows its reps; with nothing filled, the kind's own unit.
 * A bodyweight exercise stays in reps even with a belt of added weight:
 * kg × reps would leave the body out and read lighter than the work was.
 */
const UNITS_BY_KIND: Record<ExerciseKind, readonly VolumeUnit[]> = {
  [ExerciseKind.Strength]: [
    VolumeUnit.Kg,
    VolumeUnit.Reps,
    VolumeUnit.Meters,
    VolumeUnit.Seconds,
  ],
  [ExerciseKind.Bodyweight]: [VolumeUnit.Reps, VolumeUnit.Seconds],
  [ExerciseKind.Duration]: [VolumeUnit.Seconds, VolumeUnit.Reps],
  [ExerciseKind.Mobility]: [VolumeUnit.Seconds, VolumeUnit.Reps],
  [ExerciseKind.Distance]: [VolumeUnit.Meters, VolumeUnit.Seconds],
  [ExerciseKind.Cardio]: [VolumeUnit.Meters, VolumeUnit.Seconds],
};

/** A logged exercise with no catalog row: decided by what was filled. */
const UNITS_BY_FIELDS: readonly VolumeUnit[] = [
  VolumeUnit.Kg,
  VolumeUnit.Reps,
  VolumeUnit.Meters,
  VolumeUnit.Seconds,
];

export function volumeUnitFor(
  kind: string | null | undefined,
  totals: VolumeTotals,
): VolumeUnit {
  const order = UNITS_BY_KIND[kind as ExerciseKind] ?? UNITS_BY_FIELDS;
  return order.find((unit) => totals[TOTAL_OF[unit]] > 0) ?? order[0];
}

/** The totals read in one unit, whole: nobody needs a tenth of a kilo here. */
export function volumeIn(unit: VolumeUnit, totals: VolumeTotals): number {
  return Math.round(totals[TOTAL_OF[unit]]);
}

export function addVolume(a: VolumeTotals, b: VolumeTotals): VolumeTotals {
  return {
    kg: a.kg + b.kg,
    reps: a.reps + b.reps,
    seconds: a.seconds + b.seconds,
    meters: a.meters + b.meters,
  };
}

/** The fields of a logged set volume reads; decimals may arrive as strings. */
export interface VolumeSet {
  isCompleted: boolean;
  setType?: string | null;
  reps?: number | null;
  weightKg?: number | string | null;
  durationSeconds?: number | null;
  distanceMeters?: number | null;
}

/** Ticked and not a warm-up: the sets volume counts. */
export function countsTowardVolume(set: VolumeSet): boolean {
  return set.isCompleted && set.setType !== ExerciseSetType.Warmup;
}

/** The four sums over the sets that count, in code (`VOLUME_SUMS_SQL` in SQL). */
export function volumeOfSets(sets: readonly VolumeSet[]): VolumeTotals {
  let totals = NO_VOLUME;
  for (const set of sets) {
    if (!countsTowardVolume(set)) continue;
    const weight = set.weightKg == null ? null : Number(set.weightKg);
    const reps = set.reps ?? 0;
    totals = addVolume(totals, {
      kg: weight != null && set.reps != null ? weight * reps : 0,
      reps,
      seconds: set.durationSeconds ?? 0,
      meters: set.distanceMeters ?? 0,
    });
  }
  return totals;
}

/** Whole percent `current` is above (or below) `previous`; null without a base. */
export function changePercent(
  current: number,
  previous: number | null,
): number | null {
  if (previous == null || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * `countsTowardVolume` in SQL, on the `ls` (logged_set) alias every
 * volume query uses.
 */
export const COUNTED_SET_SQL = `ls.is_completed = TRUE AND ls.set_type <> 'WARMUP'`;

/**
 * The four sums as SELECT columns over a join that already holds the
 * logged sets as `ls` (unticked rows included or not: the filter is here).
 * Read them back with `volumeTotalsFromRow`.
 */
export const VOLUME_SUMS_SQL = `
        COALESCE(SUM(ls.reps * ls.weight_kg)
                 FILTER (WHERE ${COUNTED_SET_SQL} AND ls.weight_kg IS NOT NULL), 0) AS "volumeKg",
        COALESCE(SUM(ls.reps)             FILTER (WHERE ${COUNTED_SET_SQL}), 0) AS "volumeReps",
        COALESCE(SUM(ls.duration_seconds) FILTER (WHERE ${COUNTED_SET_SQL}), 0) AS "volumeSeconds",
        COALESCE(SUM(ls.distance_meters)  FILTER (WHERE ${COUNTED_SET_SQL}), 0) AS "volumeMeters"`;

/** The row `VOLUME_SUMS_SQL` produces; Postgres sends sums as strings. */
export interface VolumeSumsRow {
  volumeKg?: string | number | null;
  volumeReps?: string | number | null;
  volumeSeconds?: string | number | null;
  volumeMeters?: string | number | null;
}

export function volumeTotalsFromRow(row: VolumeSumsRow): VolumeTotals {
  return {
    kg: Number(row.volumeKg ?? 0),
    reps: Number(row.volumeReps ?? 0),
    seconds: Number(row.volumeSeconds ?? 0),
    meters: Number(row.volumeMeters ?? 0),
  };
}
