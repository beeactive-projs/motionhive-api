import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { AddPrescribedExercisesDto } from './add-prescribed-exercises.dto';
import { CopyProgramWeekDto } from './copy-program-week.dto';
import { SetPrescribedSetsDto } from './set-prescribed-sets.dto';

const EXERCISE = 'aa11cc22-dd33-44ee-8b55-ff66aa77bb88';
const SET = 'd4e5f6a7-3333-4444-8555-6666defa7777';

function errorsFor<T extends object>(
  type: new () => T,
  body: Record<string, unknown>,
) {
  return validate(plainToInstance(type, body));
}

describe('CopyProgramWeekDto', () => {
  it('takes several target weeks, or the one week older apps send', async () => {
    expect(
      await errorsFor(CopyProgramWeekDto, {
        fromWeekIndex: 0,
        toWeekIndexes: [1, 2],
      }),
    ).toEqual([]);
    expect(
      await errorsFor(CopyProgramWeekDto, { fromWeekIndex: 0, toWeekIndex: 1 }),
    ).toEqual([]);
  });

  it('needs a target, and only real weeks', async () => {
    expect(
      await errorsFor(CopyProgramWeekDto, { fromWeekIndex: 0 }),
    ).not.toEqual([]);
    expect(
      await errorsFor(CopyProgramWeekDto, {
        fromWeekIndex: 0,
        toWeekIndexes: [],
      }),
    ).not.toEqual([]);
    expect(
      await errorsFor(CopyProgramWeekDto, {
        fromWeekIndex: 0,
        toWeekIndexes: [104],
      }),
    ).not.toEqual([]);
  });
});

describe('AddPrescribedExercisesDto', () => {
  it('takes up to 30 movements with their empty sets', async () => {
    expect(
      await errorsFor(AddPrescribedExercisesDto, {
        exercises: [
          { exerciseId: EXERCISE, defaultSets: 3, restAfterSeconds: 90 },
        ],
      }),
    ).toEqual([]);
    expect(
      await errorsFor(AddPrescribedExercisesDto, {
        exercises: Array.from({ length: 31 }, () => ({ exerciseId: EXERCISE })),
      }),
    ).not.toEqual([]);
  });

  it('refuses an empty list and a movement with no id', async () => {
    expect(
      await errorsFor(AddPrescribedExercisesDto, { exercises: [] }),
    ).not.toEqual([]);
    expect(
      await errorsFor(AddPrescribedExercisesDto, {
        exercises: [{ defaultSets: 3 }],
      }),
    ).not.toEqual([]);
  });
});

describe('SetPrescribedSetsDto', () => {
  it('takes known sets by id and new ones without, nulls clearing a field', async () => {
    expect(
      await errorsFor(SetPrescribedSetsDto, {
        sets: [
          { id: SET, targetRepsMin: 8, targetWeightKg: null },
          { setType: 'WARMUP', targetRepsMin: 12, tempo: '3-1-1-0' },
        ],
      }),
    ).toEqual([]);
  });

  it('refuses no sets, a bad id, a bad tempo and an RPE past 10', async () => {
    expect(await errorsFor(SetPrescribedSetsDto, { sets: [] })).not.toEqual([]);
    expect(
      await errorsFor(SetPrescribedSetsDto, { sets: [{ id: 'nope' }] }),
    ).not.toEqual([]);
    expect(
      await errorsFor(SetPrescribedSetsDto, { sets: [{ tempo: '31-1-0' }] }),
    ).not.toEqual([]);
    expect(
      await errorsFor(SetPrescribedSetsDto, { sets: [{ targetRpe: 11 }] }),
    ).not.toEqual([]);
  });
});
