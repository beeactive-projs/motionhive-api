import { completionPercent } from './assignment-progress';

describe('completionPercent', () => {
  it('is the days completed, of all days', () => {
    expect(completionPercent(3, 10)).toBe(30);
    expect(completionPercent(1, 3)).toBe(33);
    expect(completionPercent(10, 10)).toBe(100);
  });

  it('is 0 for a plan with no days, and never over 100', () => {
    expect(completionPercent(0, 0)).toBe(0);
    expect(completionPercent(12, 10)).toBe(100);
  });
});
