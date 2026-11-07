import { ExerciseUsage, popularityScores } from './exercise-popularity.service';

const row = (overrides: Partial<ExerciseUsage>): ExerciseUsage => ({
  id: overrides.slug ?? 'x',
  slug: 'x',
  source: 'SYSTEM',
  users: 0,
  authors: 0,
  ...overrides,
});

describe('popularityScores', () => {
  it('starts from the editorial rank while nobody has used anything', () => {
    const scores = popularityScores([
      row({ slug: 'barbell-squat' }),
      row({ slug: 'sumo-deadlift' }),
      row({ slug: 'axle-deadlift' }),
    ]);
    expect(scores.get('barbell-squat')).toBe(0.5);
    expect(scores.get('sumo-deadlift')).toBe(0.4);
    expect(scores.get('axle-deadlift')).toBe(0);
  });

  it('gives a custom exercise no editorial rank, even with a staple slug', () => {
    const scores = popularityScores([
      row({ id: 'mine', slug: 'barbell-squat', source: 'INSTRUCTOR' }),
    ]);
    expect(scores.get('mine')).toBe(0);
  });

  it('lets real use lift an exercise, a plan counting half a workout', () => {
    const scores = popularityScores([
      row({ slug: 'axle-deadlift', users: 10 }),
      row({ slug: 'car-deadlift', authors: 10 }),
    ]);
    expect(scores.get('axle-deadlift')).toBeGreaterThan(
      scores.get('car-deadlift') ?? 0,
    );
    expect(scores.get('car-deadlift')).toBeGreaterThan(0);
  });

  it('does not let one person top the library while use is thin', () => {
    const scores = popularityScores([
      row({ slug: 'axle-deadlift', users: 1 }),
      row({ slug: 'barbell-squat' }),
    ]);
    expect(scores.get('axle-deadlift')).toBeLessThan(0.1);
    expect(scores.get('barbell-squat')).toBe(0.5);
  });

  it('stays between 0 and 1', () => {
    const scores = popularityScores([
      row({ slug: 'barbell-squat', users: 5000, authors: 5000 }),
      row({ slug: 'axle-deadlift', users: 3 }),
    ]);
    for (const score of scores.values()) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
    expect(scores.get('barbell-squat')).toBe(1);
  });
});
