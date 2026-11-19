import { toQueryList } from './query.utils';

describe('toQueryList', () => {
  it('reads one value, repeated params and a comma list alike', () => {
    expect(toQueryList('A')).toEqual(['A']);
    expect(toQueryList(['A', 'B'])).toEqual(['A', 'B']);
    expect(toQueryList('A,B')).toEqual(['A', 'B']);
    expect(toQueryList(['A,B', 'C'])).toEqual(['A', 'B', 'C']);
  });

  it('trims and drops empty parts', () => {
    expect(toQueryList(' A , ,B ')).toEqual(['A', 'B']);
  });

  it('is undefined for nothing, so @IsOptional skips it', () => {
    expect(toQueryList(undefined)).toBeUndefined();
    expect(toQueryList(null)).toBeUndefined();
    expect(toQueryList('')).toBeUndefined();
    expect(toQueryList(' , ')).toBeUndefined();
    expect(toQueryList([])).toBeUndefined();
  });

  it('passes non-strings through for the validators to reject', () => {
    expect(toQueryList([1, 'A'])).toEqual([1, 'A']);
  });
});
