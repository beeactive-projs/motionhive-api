import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { IsInstant } from './instant.validator';

class Probe {
  @IsInstant()
  at!: string;
}

const errorsFor = (at: string) =>
  validateSync(plainToInstance(Probe, { at })).length;

describe('IsInstant', () => {
  it('takes a time with its offset', () => {
    expect(errorsFor('2026-11-07T17:42:10.000Z')).toBe(0);
    expect(errorsFor('2026-11-07T17:42:10Z')).toBe(0);
    expect(errorsFor('2026-11-07T19:42:10+02:00')).toBe(0);
  });

  it('refuses a bare local time, which the server would read in its own zone', () => {
    expect(errorsFor('2026-11-07T17:42:10')).toBeGreaterThan(0);
    expect(errorsFor('2026-11-07')).toBeGreaterThan(0);
  });

  it('refuses what is not a date', () => {
    expect(errorsFor('soon')).toBeGreaterThan(0);
  });
});
