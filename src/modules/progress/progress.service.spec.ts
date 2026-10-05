import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { Exercise } from '../exercise/entities/exercise.entity';
import { ProgressService } from './progress.service';
import { makeSilentLogger } from '../../../test/helpers/sequelize-mocks';

/**
 * Streak math is the part worth pinning down: it is pure, it has real
 * edge cases, and getting it wrong is the kind of bug someone notices
 * emotionally before they notice it factually.
 *
 * Weeks are Monday-based ISO dates, newest first, matching what
 * `_activeWeeks` returns from Postgres `DATE_TRUNC('week', …)`.
 */
describe('ProgressService — streaks', () => {
  let service: ProgressService;
  // Reaching into the private helper on purpose: it is the unit under
  // test, and going through `overview()` would mean mocking six queries
  // to assert on arithmetic.
  const streak = (weeks: string[]) =>
    (
      service as unknown as {
        _streakFromWeeks(w: string[]): {
          currentWeeks: number;
          bestWeeks: number;
        };
      }
    )._streakFromWeeks(weeks);

  /** Monday of the current week, then N weeks back, as ISO dates. */
  const mondayOffsetWeeks = (n: number): string => {
    const now = new Date();
    const daysSinceMonday = (now.getUTCDay() + 6) % 7;
    const t = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - daysSinceMonday - n * 7,
    );
    return new Date(t).toISOString().slice(0, 10);
  };

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        ProgressService,
        { provide: getModelToken(Exercise), useValue: { findByPk: jest.fn() } },
        { provide: Sequelize, useValue: { query: jest.fn() } },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();
    service = module.get(ProgressService);
  });

  // ─── roster: why a client needs attention ────────────────────────

  describe('roster — the attention reason', () => {
    const reason = (input: Record<string, unknown>) =>
      (
        service as unknown as {
          _attentionReason(i: Record<string, unknown>): string | null;
        }
      )._attentionReason({
        activePlans: 1,
        lastWorkoutAt: new Date(),
        daysSince: 0,
        adherencePercent: 100,
        previousAdherencePercent: 100,
        ...input,
      });

    it('flags someone with no active plan ahead of every other reason', () => {
      // Nothing assigned means nothing to be behind on — which used to
      // return null and file them under "On track", beside people who are
      // actually training. It is the coach's omission, and the one thing
      // on the screen they can fix outright, so it outranks the rest.
      expect(reason({ activePlans: 0, lastWorkoutAt: null })).toBe('NO_PLAN');
      expect(reason({ activePlans: 0, daysSince: 30 })).toBe('NO_PLAN');
    });

    it('flags an assigned client who has never logged anything', () => {
      expect(reason({ lastWorkoutAt: null })).toBe('NEVER_STARTED');
    });

    it('flags two weeks of silence ahead of any adherence maths', () => {
      // Someone who has gone quiet matters more than someone whose
      // percentage dipped, so silence wins even on perfect adherence.
      expect(reason({ daysSince: 14 })).toBe('SILENT');
    });

    it('does not call thirteen days silent', () => {
      expect(reason({ daysSince: 13 })).toBeNull();
    });

    it('flags a twenty-point drop even while adherence is still decent', () => {
      expect(
        reason({ adherencePercent: 70, previousAdherencePercent: 90 }),
      ).toBe('DROPPED');
    });

    it('ignores a drop smaller than the threshold', () => {
      expect(
        reason({ adherencePercent: 75, previousAdherencePercent: 90 }),
      ).toBeNull();
    });

    it('flags being behind when there is no prior window to compare', () => {
      expect(
        reason({ adherencePercent: 40, previousAdherencePercent: null }),
      ).toBe('BEHIND');
    });

    it('says nothing about a client with no work due', () => {
      // Null adherence means the question does not apply; it is not 0%.
      expect(
        reason({ adherencePercent: null, previousAdherencePercent: null }),
      ).toBeNull();
    });
  });

  it('reports nothing for someone who has never trained', () => {
    expect(streak([])).toEqual({ currentWeeks: 0, bestWeeks: 0 });
  });

  it('counts consecutive weeks ending this week', () => {
    const weeks = [0, 1, 2].map(mondayOffsetWeeks);
    expect(streak(weeks)).toEqual({ currentWeeks: 3, bestWeeks: 3 });
  });

  it('keeps the streak alive when the current week has no workout yet', () => {
    // Someone who trains Mon-Fri should not watch their streak die on a
    // Sunday before they have had the chance to train.
    const weeks = [1, 2, 3].map(mondayOffsetWeeks);
    expect(streak(weeks).currentWeeks).toBe(3);
  });

  it('breaks the current streak once two weeks have been missed', () => {
    const weeks = [2, 3, 4].map(mondayOffsetWeeks);
    const res = streak(weeks);
    expect(res.currentWeeks).toBe(0);
    // The run still happened, so the personal best survives.
    expect(res.bestWeeks).toBe(3);
  });

  it('remembers the best run even when the current one is shorter', () => {
    // Trained this week and last, then a gap, then a 4-week block.
    const weeks = [0, 1, 5, 6, 7, 8].map(mondayOffsetWeeks);
    expect(streak(weeks)).toEqual({ currentWeeks: 2, bestWeeks: 4 });
  });

  it('treats a single lonely week as a streak of one', () => {
    expect(streak([mondayOffsetWeeks(0)])).toEqual({
      currentWeeks: 1,
      bestWeeks: 1,
    });
  });
});
