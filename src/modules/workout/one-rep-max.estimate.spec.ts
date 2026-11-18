import {
  MAX_ONE_REP_MAX_KG,
  countsForRecords,
  estimateOneRepMaxEpley,
} from './one-rep-max.estimate';

describe('estimateOneRepMaxEpley', () => {
  it('takes a single as its own max', () => {
    expect(estimateOneRepMaxEpley(1, 100)).toBe(100);
  });

  it('estimates sets of 2 to 12 by Epley', () => {
    expect(estimateOneRepMaxEpley(5, 80)).toBe(93.33);
    expect(estimateOneRepMaxEpley(12, 60)).toBe(84);
  });

  it('estimates nothing past what one_rep_max can store', () => {
    expect(estimateOneRepMaxEpley(12, 8000)).toBeNull();
    expect(estimateOneRepMaxEpley(1, MAX_ONE_REP_MAX_KG)).toBe(
      MAX_ONE_REP_MAX_KG,
    );
  });
});

describe('countsForRecords', () => {
  it('gives every kind a record but bodyweight', () => {
    expect(countsForRecords('BODYWEIGHT')).toBe(false);
    expect(countsForRecords('STRENGTH')).toBe(true);
    expect(countsForRecords(null)).toBe(true);
  });
});
