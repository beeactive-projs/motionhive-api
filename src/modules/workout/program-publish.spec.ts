import {
  hasUsableProgramName,
  UNTITLED_PROGRAM_NAMES,
} from './program-publish';

describe('hasUsableProgramName', () => {
  it('takes a name someone gave the program', () => {
    expect(hasUsableProgramName('Strength base')).toBe(true);
    // A real name that merely starts like the default is still a name.
    expect(hasUsableProgramName('Untitled program 2')).toBe(true);
  });

  it('refuses no name at all', () => {
    expect(hasUsableProgramName(null)).toBe(false);
    expect(hasUsableProgramName(undefined)).toBe(false);
    expect(hasUsableProgramName('')).toBe(false);
    expect(hasUsableProgramName('   ')).toBe(false);
  });

  it('refuses the name a new draft is born with, in either language', () => {
    expect(UNTITLED_PROGRAM_NAMES).toEqual([
      'Untitled program',
      'Program fără titlu',
    ]);
    for (const name of UNTITLED_PROGRAM_NAMES) {
      expect(hasUsableProgramName(name)).toBe(false);
      expect(hasUsableProgramName(` ${name} `)).toBe(false);
    }
  });
});
