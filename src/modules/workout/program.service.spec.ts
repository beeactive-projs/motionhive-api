import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { Exercise } from '../exercise/entities/exercise.entity';
import {
  ExerciseSource,
  ExerciseVisibility,
} from '../exercise/entities/exercise.enums';
import { PrescribedExercise } from './entities/prescribed-exercise.entity';
import { PrescribedSet } from './entities/prescribed-set.entity';
import { Program } from './entities/program.entity';
import { ProgramWorkout } from './entities/program-workout.entity';
import { ProgramService } from './program.service';
import {
  ProgramArchivedFilter,
  ProgramLibrary,
} from './dto/list-programs.query.dto';
import { ProgramSource } from './entities/workout.enums';
import { ProgramAssignment } from './entities/program-assignment.entity';
import {
  fakeTx,
  makeSequelizeMock,
  makeSilentLogger,
} from '../../../test/helpers/sequelize-mocks';

/**
 * Smoke tests for ProgramService — not exhaustive.
 *
 * Covers the load-bearing paths: ownership hide-existence, nested-id
 * parent assertion (workout must belong to program, set must belong
 * to exercise), uniqueness on (week, day), sequence-number /
 * order-index auto-allocation, and cross-field set coherence.
 */
describe('ProgramService (smoke — not exhaustive)', () => {
  let service: ProgramService;

  const programModel = {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
  };

  const assignmentModel = { count: jest.fn(), update: jest.fn() };
  const workoutModel = {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
    count: jest.fn(),
    max: jest.fn(),
  };
  const prescribedExerciseModel = {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
    max: jest.fn(),
  };
  const prescribedSetModel = {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    bulkCreate: jest.fn(),
    max: jest.fn(),
  };
  const exerciseModel = { findByPk: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        ProgramService,
        { provide: getModelToken(Program), useValue: programModel },
        {
          provide: getModelToken(ProgramAssignment),
          useValue: assignmentModel,
        },
        { provide: getModelToken(ProgramWorkout), useValue: workoutModel },
        {
          provide: getModelToken(PrescribedExercise),
          useValue: prescribedExerciseModel,
        },
        { provide: getModelToken(PrescribedSet), useValue: prescribedSetModel },
        { provide: getModelToken(Exercise), useValue: exerciseModel },
        { provide: Sequelize, useValue: makeSequelizeMock() },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();
    service = module.get(ProgramService);
  });

  // ─── Copy into your library ──────────────────────────────────────

  describe('duplicateForUser', () => {
    const starter = {
      id: 'p-src',
      ownerId: null,
      source: 'SYSTEM',
      name: 'Full body starter',
      workouts: [],
    };

    it.each([
      ['en', 'Full body starter (my copy)'],
      ['ro', 'Full body starter (copia mea)'],
    ] as const)(
      "names the copy in the copier's language (%s)",
      async (locale, name) => {
        programModel.findOne.mockResolvedValueOnce(starter);
        programModel.create.mockResolvedValueOnce({ id: 'p-copy' });

        await service.duplicateForUser('p-src', 'me', locale);

        expect(programModel.create).toHaveBeenCalledWith(
          expect.objectContaining({ ownerId: 'me', name }),
          expect.anything(),
        );
      },
    );
  });

  // ─── Ownership hide-existence ────────────────────────────────────

  describe('program ownership', () => {
    it('hides existence when the program belongs to another instructor', async () => {
      programModel.findByPk.mockResolvedValueOnce({
        id: 'p-1',
        ownerId: 'other-owner',
      });
      await expect(service.findById('p-1', 'me')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns 404 when the program does not exist', async () => {
      programModel.findByPk.mockResolvedValueOnce(null);
      await expect(
        service.update('missing', { name: 'X' }, 'me'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── create — provenance stamping (migration 056) ─────────────────

  describe('create — source stamping', () => {
    it('stamps INSTRUCTOR when a coach authors', async () => {
      programModel.create.mockResolvedValueOnce({ id: 'p-1' });
      await service.create({ name: 'Hypertrophy base' }, 'coach-1', true);

      expect(programModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'INSTRUCTOR',
          ownerId: 'coach-1',
          isSingleWorkout: false,
        }),
      );
    });

    it('stamps USER and honours isSingleWorkout for a self-authored routine', async () => {
      programModel.create.mockResolvedValueOnce({ id: 'p-2' });
      workoutModel.create.mockResolvedValueOnce({ id: 'pw-2' });

      await service.create(
        { name: 'Push day A', isSingleWorkout: true, folder: 'PPL' },
        'me',
        false,
      );

      expect(programModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'USER',
          ownerId: 'me',
          isSingleWorkout: true,
          folder: 'PPL',
        }),
        expect.anything(),
      );
      // A routine always gets its single workout, at week 0 / day 0.
      expect(workoutModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          programId: 'p-2',
          weekIndex: 0,
          dayIndex: 0,
          sequenceNumber: 0,
        }),
        expect.anything(),
      );
    });

    it('expands defaultSets into that many prescribed sets', async () => {
      programModel.create.mockResolvedValueOnce({ id: 'p-3' });
      workoutModel.create.mockResolvedValueOnce({ id: 'pw-3' });
      prescribedExerciseModel.create.mockResolvedValueOnce({ id: 'pe-3' });

      await service.create(
        {
          name: 'Squat day',
          isSingleWorkout: true,
          exercises: [{ exerciseId: 'ex-1', defaultSets: 4, targetRepsMin: 8 }],
        },
        'me',
        false,
      );

      const [rows] = prescribedSetModel.bulkCreate.mock.calls[0] as [
        Array<Record<string, unknown>>,
      ];
      expect(rows).toHaveLength(4);
      expect(rows[0]).toEqual(
        expect.objectContaining({
          prescribedExerciseId: 'pe-3',
          orderIndex: 0,
          targetRepsMin: 8,
        }),
      );
    });

    it('writes explicit per-set rows when the editor sends them', async () => {
      programModel.create.mockResolvedValueOnce({ id: 'p-4' });
      workoutModel.create.mockResolvedValueOnce({ id: 'pw-4' });
      prescribedExerciseModel.create.mockResolvedValueOnce({ id: 'pe-4' });

      // A warm-up, a top set, two backoffs — the shape `defaultSets`
      // cannot express.
      await service.create(
        {
          name: 'Squat day',
          isSingleWorkout: true,
          exercises: [
            {
              exerciseId: 'ex-1',
              defaultSets: 99, // must be ignored when `sets` is present
              sets: [
                {
                  setType: 'WARMUP' as never,
                  targetRepsMin: 8,
                  targetWeightKg: 60,
                },
                {
                  setType: 'NORMAL' as never,
                  targetRepsMin: 5,
                  targetWeightKg: 100,
                },
                {
                  setType: 'NORMAL' as never,
                  targetRepsMin: 8,
                  targetWeightKg: 85,
                },
              ],
            },
          ],
        },
        'me',
        false,
      );

      const [rows] = prescribedSetModel.bulkCreate.mock.calls[0] as [
        Array<Record<string, unknown>>,
      ];
      expect(rows).toHaveLength(3);
      expect(rows.map((r) => [r.setType, r.targetWeightKg])).toEqual([
        ['WARMUP', 60],
        ['NORMAL', 100],
        ['NORMAL', 85],
      ]);
    });

    it('refuses nested exercises on a multi-week program', async () => {
      await expect(
        service.create(
          { name: 'Block', exercises: [{ exerciseId: 'ex-1' }] },
          'me',
          true,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── list — server-computed exercise count ───────────────────────

  describe('list — whose library', () => {
    const whereOf = () =>
      (
        programModel.findAndCountAll.mock.calls[0][0] as {
          where: Record<string, unknown>;
        }
      ).where;

    beforeEach(() => {
      programModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
      prescribedExerciseModel.findAll.mockResolvedValue([]);
    });

    it('defaults to yours plus MotionHive starters', async () => {
      await service.list({ isSingleWorkout: true }, 'me');
      // A plain `ownerId: 'me'` here would hide every starter, which is
      // what kept the seeded content invisible to everyone.
      const w = whereOf();
      expect(w['ownerId']).toBeUndefined();
      const bySymbol = w as unknown as Record<symbol, unknown>;
      const or = Object.getOwnPropertySymbols(w).map((x) => bySymbol[x])[0];
      expect(or).toEqual([{ ownerId: 'me' }, { source: ProgramSource.System }]);
    });

    it('narrows to your own library on request', async () => {
      await service.list(
        { isSingleWorkout: true, library: ProgramLibrary.Mine },
        'me',
      );
      expect(whereOf()).toEqual(expect.objectContaining({ ownerId: 'me' }));
    });

    it('narrows to starters on request', async () => {
      await service.list(
        { isSingleWorkout: true, library: ProgramLibrary.System },
        'me',
      );
      const w = whereOf();
      expect(w).toEqual(
        expect.objectContaining({ source: ProgramSource.System }),
      );
      expect(w['ownerId']).toBeUndefined();
    });
  });

  describe('list — exercise count', () => {
    it('attaches a count per row without shipping the tree', async () => {
      programModel.findAndCountAll.mockResolvedValueOnce({
        rows: [
          { id: 'p-1', toJSON: () => ({ id: 'p-1', name: 'Push day A' }) },
          { id: 'p-2', toJSON: () => ({ id: 'p-2', name: 'Pull day B' }) },
        ],
        count: 2,
      });
      // Only p-1 has exercises; p-2 must still render as 0, not undefined.
      prescribedExerciseModel.findAll.mockResolvedValueOnce([
        { programId: 'p-1', total: '3' },
      ]);

      const res = await service.list({ isSingleWorkout: true }, 'me');

      expect(res.items).toEqual([
        expect.objectContaining({ id: 'p-1', exerciseCount: 3 }),
        expect.objectContaining({ id: 'p-2', exerciseCount: 0 }),
      ]);
    });

    it('skips the count query entirely when the page is empty', async () => {
      programModel.findAndCountAll.mockResolvedValueOnce({
        rows: [],
        count: 0,
      });

      const res = await service.list({}, 'me');

      expect(res.items).toEqual([]);
      expect(prescribedExerciseModel.findAll).not.toHaveBeenCalled();
    });
  });

  // ─── update — routine tree replacement ───────────────────────────

  describe('update — replacing a routine tree', () => {
    it('clears the old exercises before writing the new ones', async () => {
      programModel.findByPk.mockResolvedValueOnce({
        id: 'p-1',
        ownerId: 'me',
        isSingleWorkout: true,
        update: jest.fn().mockResolvedValue(undefined),
      });
      workoutModel.findOne.mockResolvedValueOnce({ id: 'pw-1' });
      prescribedExerciseModel.create.mockResolvedValueOnce({ id: 'pe-9' });

      await service.update(
        'p-1',
        { exercises: [{ exerciseId: 'ex-9', defaultSets: 5 }] },
        'me',
      );

      expect(prescribedExerciseModel.destroy).toHaveBeenCalledWith(
        expect.objectContaining({ where: { programWorkoutId: 'pw-1' } }),
      );
      expect(prescribedSetModel.bulkCreate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ prescribedExerciseId: 'pe-9' }),
        ]),
        expect.anything(),
      );
    });

    it('drops the weeks a shortened program no longer has room for', async () => {
      programModel.findByPk.mockResolvedValueOnce({
        id: 'p-3',
        ownerId: 'me',
        isSingleWorkout: false,
        update: jest.fn().mockResolvedValue(undefined),
      });
      workoutModel.count.mockResolvedValueOnce(2); // week 3+ holds work
      assignmentModel.count.mockResolvedValueOnce(0); // nobody on it

      await service.update('p-3', { durationDays: 21 }, 'me');

      // 21 days = 3 weeks, so weeks 3 and up go.
      expect(workoutModel.destroy).toHaveBeenCalledWith({
        where: { programId: 'p-3', weekIndex: { [Op.gte]: 3 } },
      });
    });

    it('refuses to shorten a program clients are still training', async () => {
      programModel.findByPk.mockResolvedValueOnce({
        id: 'p-4',
        ownerId: 'me',
        isSingleWorkout: false,
        update: jest.fn(),
      });
      workoutModel.count.mockResolvedValueOnce(3);
      assignmentModel.count.mockResolvedValueOnce(1);

      await expect(
        service.update('p-4', { durationDays: 7 }, 'me'),
      ).rejects.toThrow(ConflictException);
      expect(workoutModel.destroy).not.toHaveBeenCalled();
    });

    it('leaves the tree alone when the new length still covers it', async () => {
      programModel.findByPk.mockResolvedValueOnce({
        id: 'p-5',
        ownerId: 'me',
        isSingleWorkout: false,
        update: jest.fn().mockResolvedValue(undefined),
      });
      workoutModel.count.mockResolvedValueOnce(0); // nothing past the new end

      await service.update('p-5', { durationDays: 84 }, 'me');

      // No roster check needed when nothing would be lost.
      expect(assignmentModel.count).not.toHaveBeenCalled();
      expect(workoutModel.destroy).not.toHaveBeenCalled();
    });

    it('refuses a nested edit on a multi-week program', async () => {
      programModel.findByPk.mockResolvedValueOnce({
        id: 'p-2',
        ownerId: 'me',
        isSingleWorkout: false,
        update: jest.fn(),
      });

      await expect(
        service.update('p-2', { exercises: [{ exerciseId: 'ex-1' }] }, 'me'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── Nested parent assertion ─────────────────────────────────────

  describe('nested parent assertion', () => {
    it('throws when a workout is not in the requested program', async () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce(null); // not in this program

      await expect(
        service.updateWorkout('p-1', 'w-other', { name: 'X' }, 'me'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when an exercise slot is not in the requested workout', async () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce({
        id: 'w-1',
        programId: 'p-1',
      });
      prescribedExerciseModel.findOne.mockResolvedValueOnce(null);

      await expect(
        service.removeExercise('p-1', 'w-1', 'e-other', 'me'),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws when a set is not in the requested exercise slot', async () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce({
        id: 'w-1',
        programId: 'p-1',
      });
      prescribedExerciseModel.findOne.mockResolvedValueOnce({
        id: 'e-1',
        programWorkoutId: 'w-1',
      });
      prescribedSetModel.findOne.mockResolvedValueOnce(null);

      await expect(
        service.removeSet('p-1', 'w-1', 'e-1', 's-other', 'me'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Workout uniqueness ──────────────────────────────────────────

  describe('addWorkout', () => {
    it('rejects when (weekIndex, dayIndex) is already occupied', async () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce({ id: 'w-existing' });

      await expect(
        service.addWorkout(
          'p-1',
          { name: 'Day 1', weekIndex: 0, dayIndex: 0 },
          'me',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('computes sequenceNumber = (max + 1) on append', async () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce(null); // no clash
      workoutModel.max.mockResolvedValueOnce(4); // 5 existing workouts (0..4)
      workoutModel.create.mockResolvedValueOnce({ id: 'w-new' });

      await service.addWorkout(
        'p-1',
        { name: 'Day 6', weekIndex: 1, dayIndex: 1 },
        'me',
      );

      expect(workoutModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ sequenceNumber: 5 }),
      );
    });

    it('uses sequenceNumber=0 for the very first workout', async () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce(null);
      workoutModel.max.mockResolvedValueOnce(null);
      workoutModel.create.mockResolvedValueOnce({ id: 'w-new' });

      await service.addWorkout(
        'p-1',
        { name: 'Day 1', weekIndex: 0, dayIndex: 0 },
        'me',
      );

      expect(workoutModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ sequenceNumber: 0 }),
      );
    });
  });

  // ─── Workout reorder (atomic repositioning) ──────────────────────

  describe('reorderWorkouts', () => {
    /** Fake row whose update() mutates in place like a Sequelize instance. */
    const makeWorkout = (
      id: string,
      weekIndex: number,
      dayIndex: number,
      sequenceNumber: number,
    ) => {
      const w = { id, weekIndex, dayIndex, sequenceNumber } as {
        id: string;
        weekIndex: number;
        dayIndex: number;
        sequenceNumber: number;
        update: jest.Mock;
      };
      w.update = jest.fn((values: object) => {
        Object.assign(w, values);
        return Promise.resolve(w);
      });
      return w;
    };

    const setupProgram = () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
    };

    it('404s when an item references a workout outside the program', async () => {
      setupProgram();
      workoutModel.findAll.mockResolvedValueOnce([makeWorkout('w-1', 0, 0, 0)]);

      await expect(
        service.reorderWorkouts(
          'p-1',
          { items: [{ id: 'w-foreign', weekIndex: 0, dayIndex: 1 }] },
          'me',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects duplicate workout ids in items', async () => {
      setupProgram();
      workoutModel.findAll.mockResolvedValueOnce([makeWorkout('w-1', 0, 0, 0)]);

      await expect(
        service.reorderWorkouts(
          'p-1',
          {
            items: [
              { id: 'w-1', weekIndex: 0, dayIndex: 1 },
              { id: 'w-1', weekIndex: 0, dayIndex: 2 },
            ],
          },
          'me',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('409s when a target slot collides with an untouched workout', async () => {
      setupProgram();
      workoutModel.findAll.mockResolvedValueOnce([
        makeWorkout('w-1', 0, 0, 0),
        makeWorkout('w-2', 0, 2, 1), // stays put — occupies (0, 2)
      ]);

      await expect(
        service.reorderWorkouts(
          'p-1',
          { items: [{ id: 'w-1', weekIndex: 0, dayIndex: 2 }] },
          'me',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('swaps two days via the parked week namespace and renumbers sequence', async () => {
      setupProgram();
      const w1 = makeWorkout('w-1', 0, 0, 0);
      const w2 = makeWorkout('w-2', 0, 2, 1);
      workoutModel.findAll
        .mockResolvedValueOnce([w1, w2]) // load
        .mockResolvedValueOnce([w2, w1]); // post-reorder return

      await service.reorderWorkouts(
        'p-1',
        {
          items: [
            { id: 'w-1', weekIndex: 0, dayIndex: 2 },
            { id: 'w-2', weekIndex: 0, dayIndex: 0 },
          ],
        },
        'me',
      );

      // Phase 1 parks out of collision range before any final write.
      expect(w1.update.mock.calls[0][0]).toEqual({ weekIndex: 10_000 });
      expect(w2.update.mock.calls[0][0]).toEqual({ weekIndex: 10_000 });
      // Phase 2 writes the validated final slots.
      expect(w1.update.mock.calls[1][0]).toEqual({ weekIndex: 0, dayIndex: 2 });
      expect(w2.update.mock.calls[1][0]).toEqual({ weekIndex: 0, dayIndex: 0 });
      // sequenceNumber follows calendar order: w2 (day 0) then w1 (day 2).
      expect(w2.update).toHaveBeenCalledWith(
        { sequenceNumber: 0 },
        expect.anything(),
      );
      expect(w1.update).toHaveBeenCalledWith(
        { sequenceNumber: 1 },
        expect.anything(),
      );
    });

    it('skips the transaction entirely when nothing actually moves', async () => {
      setupProgram();
      const w1 = makeWorkout('w-1', 0, 0, 0);
      workoutModel.findAll
        .mockResolvedValueOnce([w1])
        .mockResolvedValueOnce([w1]);

      await service.reorderWorkouts(
        'p-1',
        { items: [{ id: 'w-1', weekIndex: 0, dayIndex: 0 }] },
        'me',
      );

      expect(w1.update).not.toHaveBeenCalled();
    });
  });

  // ─── Exercise usability gate ─────────────────────────────────────

  describe('addExercise — exercise usability', () => {
    const setupChain = () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce({
        id: 'w-1',
        programId: 'p-1',
      });
    };

    it('accepts a SYSTEM exercise', async () => {
      setupChain();
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'ex-sys',
        source: ExerciseSource.System,
        visibility: ExerciseVisibility.Public,
        ownerId: null,
      });
      prescribedExerciseModel.max.mockResolvedValueOnce(null);
      prescribedExerciseModel.create.mockResolvedValueOnce({ id: 'pe-1' });

      await expect(
        service.addExercise('p-1', 'w-1', { exerciseId: 'ex-sys' }, 'me'),
      ).resolves.toBeTruthy();
    });

    it('hides existence of PRIVATE exercises owned by another instructor', async () => {
      setupChain();
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'ex-priv',
        source: ExerciseSource.Instructor,
        visibility: ExerciseVisibility.Private,
        ownerId: 'other-owner',
      });

      await expect(
        service.addExercise('p-1', 'w-1', { exerciseId: 'ex-priv' }, 'me'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Set coherence ───────────────────────────────────────────────

  describe('addSet — cross-field validation', () => {
    const setupChain = () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce({
        id: 'w-1',
        programId: 'p-1',
      });
      prescribedExerciseModel.findOne.mockResolvedValueOnce({
        id: 'e-1',
        programWorkoutId: 'w-1',
      });
    };

    it('rejects targetRepsMin > targetRepsMax', async () => {
      setupChain();
      await expect(
        service.addSet(
          'p-1',
          'w-1',
          'e-1',
          { targetRepsMin: 8, targetRepsMax: 5 },
          'me',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects passing BOTH targetWeightKg AND targetWeightPercent1rm', async () => {
      setupChain();
      await expect(
        service.addSet(
          'p-1',
          'w-1',
          'e-1',
          { targetWeightKg: 80, targetWeightPercent1rm: 75 },
          'me',
        ),
      ).rejects.toThrow(/Pick either/);
    });

    it('appends with orderIndex = max + 1', async () => {
      setupChain();
      prescribedSetModel.max.mockResolvedValueOnce(2);
      prescribedSetModel.create.mockResolvedValueOnce({ id: 's-3' });

      await service.addSet(
        'p-1',
        'w-1',
        'e-1',
        { targetRepsMin: 5, targetRepsMax: 5, targetWeightKg: 80 },
        'me',
      );

      expect(prescribedSetModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ orderIndex: 3 }),
      );
    });
  });

  describe('addExercise — defaultSets shorthand', () => {
    it('creates that many empty sets with the exercise in one transaction', async () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce({
        id: 'w-1',
        programId: 'p-1',
      });
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'ex-1',
        source: ExerciseSource.System,
        visibility: ExerciseVisibility.Public,
        ownerId: null,
      });
      prescribedExerciseModel.max.mockResolvedValueOnce(null);
      prescribedExerciseModel.create.mockResolvedValueOnce({ id: 'e-new' });

      await service.addExercise(
        'p-1',
        'w-1',
        { exerciseId: 'ex-1', defaultSets: 3 },
        'me',
      );

      expect(prescribedExerciseModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ exerciseId: 'ex-1' }),
        { transaction: fakeTx },
      );
      expect(prescribedSetModel.bulkCreate).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            prescribedExerciseId: 'e-new',
            orderIndex: 0,
          }),
          expect.objectContaining({
            prescribedExerciseId: 'e-new',
            orderIndex: 1,
          }),
          expect.objectContaining({
            prescribedExerciseId: 'e-new',
            orderIndex: 2,
          }),
        ],
        { transaction: fakeTx },
      );
    });
  });

  describe('reorderExercises', () => {
    const row = (id: string, orderIndex: number) => ({
      id,
      orderIndex,
      update: jest.fn().mockResolvedValue(undefined),
    });

    it('writes only the rows that moved, in one transaction', async () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce({
        id: 'w-1',
        programId: 'p-1',
      });
      const a = row('e-a', 0);
      const b = row('e-b', 1);
      prescribedExerciseModel.findAll
        .mockResolvedValueOnce([a, b])
        .mockResolvedValueOnce([b, a]);

      await service.reorderExercises(
        'p-1',
        'w-1',
        {
          items: [
            { id: 'e-a', orderIndex: 1 },
            { id: 'e-b', orderIndex: 0 },
          ],
        },
        'me',
      );

      expect(a.update).toHaveBeenCalledWith(
        { orderIndex: 1 },
        { transaction: fakeTx },
      );
      expect(b.update).toHaveBeenCalledWith(
        { orderIndex: 0 },
        { transaction: fakeTx },
      );
    });

    it('404s on a row outside the workout', async () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce({
        id: 'w-1',
        programId: 'p-1',
      });
      prescribedExerciseModel.findAll.mockResolvedValueOnce([row('e-a', 0)]);
      await expect(
        service.reorderExercises(
          'p-1',
          'w-1',
          { items: [{ id: 'e-x', orderIndex: 0 }] },
          'me',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('409s when two rows would share an index', async () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce({
        id: 'w-1',
        programId: 'p-1',
      });
      prescribedExerciseModel.findAll.mockResolvedValueOnce([
        row('e-a', 0),
        row('e-b', 1),
      ]);
      await expect(
        service.reorderExercises(
          'p-1',
          'w-1',
          { items: [{ id: 'e-a', orderIndex: 1 }] },
          'me',
        ),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ─── Week copy (one transaction, target replaced) ────────────────

  describe('copyWeek', () => {
    const owned = () =>
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });

    it('rejects copying a week onto itself', async () => {
      owned();
      await expect(
        service.copyWeek('p-1', { fromWeekIndex: 1, toWeekIndex: 1 }, 'me'),
      ).rejects.toThrow(BadRequestException);
      expect(workoutModel.findAll).not.toHaveBeenCalled();
    });

    it('rejects an empty source week', async () => {
      owned();
      workoutModel.findAll.mockResolvedValueOnce([]);
      await expect(
        service.copyWeek('p-1', { fromWeekIndex: 0, toWeekIndex: 1 }, 'me'),
      ).rejects.toThrow(BadRequestException);
      expect(workoutModel.destroy).not.toHaveBeenCalled();
    });

    it('replaces the target week and copies the whole tree in one transaction', async () => {
      owned();
      workoutModel.findAll.mockResolvedValueOnce([
        {
          name: 'Day 1',
          notes: null,
          dayIndex: 0,
          sequenceNumber: 0,
          phase: null,
          estimatedDurationMinutes: 45,
          exercises: [
            {
              exerciseId: 'ex-squat',
              blockId: null,
              supersetGroupId: null,
              orderIndex: 0,
              notes: null,
              alternateExerciseId: null,
              sets: [
                {
                  orderIndex: 0,
                  setType: 'WORKING',
                  targetRepsMin: 5,
                  targetRepsMax: 5,
                },
                {
                  orderIndex: 1,
                  setType: 'WORKING',
                  targetRepsMin: 5,
                  targetRepsMax: 5,
                },
              ],
            },
          ],
        },
        { name: 'Day 3', dayIndex: 2, sequenceNumber: 1, exercises: [] },
      ]);
      workoutModel.create
        .mockResolvedValueOnce({ id: 'w-copy-1' })
        .mockResolvedValueOnce({ id: 'w-copy-2' });
      prescribedExerciseModel.create.mockResolvedValueOnce({ id: 'e-copy-1' });

      // The renumbering pass: a clone arrives carrying its source's number.
      const stale = { sequenceNumber: 7, update: jest.fn() };
      workoutModel.findAll.mockResolvedValueOnce([stale]);

      const copied = await service.copyWeek(
        'p-1',
        { fromWeekIndex: 0, toWeekIndex: 2 },
        'me',
      );

      expect(stale.update).toHaveBeenCalledWith(
        { sequenceNumber: 0 },
        { transaction: fakeTx },
      );

      expect(copied.map((w) => w.id)).toEqual(['w-copy-1', 'w-copy-2']);

      // Whatever the target held is gone before the copy lands.
      expect(workoutModel.destroy).toHaveBeenCalledWith({
        where: { programId: 'p-1', weekIndex: 2 },
        transaction: fakeTx,
      });

      expect(workoutModel.create).toHaveBeenCalledTimes(2);
      expect(workoutModel.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ name: 'Day 1', weekIndex: 2, dayIndex: 0 }),
        { transaction: fakeTx },
      );
      expect(prescribedExerciseModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          programWorkoutId: 'w-copy-1',
          exerciseId: 'ex-squat',
        }),
        { transaction: fakeTx },
      );
      expect(prescribedSetModel.bulkCreate).toHaveBeenCalledTimes(1);
      expect(prescribedSetModel.bulkCreate).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            prescribedExerciseId: 'e-copy-1',
            orderIndex: 0,
          }),
          expect.objectContaining({
            prescribedExerciseId: 'e-copy-1',
            orderIndex: 1,
          }),
        ],
        { transaction: fakeTx },
      );
    });
  });

  describe('copyDay', () => {
    const owned = () =>
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });

    const sourceDay = {
      name: 'Upper A',
      notes: null,
      dayIndex: 1,
      sequenceNumber: 0,
      phase: null,
      estimatedDurationMinutes: 50,
      exercises: [
        {
          exerciseId: 'ex-bench',
          blockId: null,
          supersetGroupId: null,
          orderIndex: 0,
          notes: null,
          alternateExerciseId: null,
          sets: [{ orderIndex: 0, setType: 'WORKING', targetRepsMin: 8 }],
        },
      ],
    };

    it('drops the source week from the targets rather than copying onto itself', async () => {
      owned();
      await expect(
        service.copyDay(
          'p-1',
          { fromWeekIndex: 0, dayIndex: 1, toWeekIndexes: [0] },
          'me',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(workoutModel.findOne).not.toHaveBeenCalled();
    });

    it('rejects a day slot with nothing in it', async () => {
      owned();
      workoutModel.findOne.mockResolvedValueOnce(null);
      await expect(
        service.copyDay(
          'p-1',
          { fromWeekIndex: 0, dayIndex: 1, toWeekIndexes: [1] },
          'me',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(workoutModel.destroy).not.toHaveBeenCalled();
    });

    it('replaces only that day slot in each target week, in one transaction', async () => {
      owned();
      workoutModel.findOne.mockResolvedValueOnce(sourceDay);
      workoutModel.findAll.mockResolvedValueOnce([]);
      workoutModel.create
        .mockResolvedValueOnce({ id: 'w-d2' })
        .mockResolvedValueOnce({ id: 'w-d3' });
      prescribedExerciseModel.create
        .mockResolvedValueOnce({ id: 'e-1' })
        .mockResolvedValueOnce({ id: 'e-2' });

      const copied = await service.copyDay(
        'p-1',
        { fromWeekIndex: 0, dayIndex: 1, toWeekIndexes: [2, 3] },
        'me',
      );

      expect(copied.map((w) => w.id)).toEqual(['w-d2', 'w-d3']);

      // The destroy is scoped to the one day — the rest of those weeks is
      // untouched, which is the whole difference from copy-week.
      expect(workoutModel.destroy).toHaveBeenCalledWith({
        where: { programId: 'p-1', weekIndex: [2, 3], dayIndex: 1 },
        transaction: fakeTx,
      });

      // Same slot in each target, never a different day.
      expect(workoutModel.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ name: 'Upper A', weekIndex: 2, dayIndex: 1 }),
        { transaction: fakeTx },
      );
      expect(workoutModel.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ name: 'Upper A', weekIndex: 3, dayIndex: 1 }),
        { transaction: fakeTx },
      );

      // The tree travels with it, once per target.
      expect(prescribedExerciseModel.create).toHaveBeenCalledTimes(2);
      expect(prescribedSetModel.bulkCreate).toHaveBeenCalledTimes(2);
    });

    it('lands on a different day when asked, leaving the source day alone', async () => {
      // "Monday's work, but on Thursday" — within the same week, so the
      // source row must survive the destroy that clears the target slot.
      owned();
      workoutModel.findOne.mockResolvedValueOnce(sourceDay);
      workoutModel.findAll.mockResolvedValueOnce([]);
      workoutModel.create.mockResolvedValueOnce({ id: 'w-thu' });
      prescribedExerciseModel.create.mockResolvedValueOnce({ id: 'e-1' });

      await service.copyDay(
        'p-1',
        { fromWeekIndex: 0, dayIndex: 1, toWeekIndexes: [0], toDayIndex: 3 },
        'me',
      );

      // Only the target day is cleared — never the day being copied from.
      expect(workoutModel.destroy).toHaveBeenCalledWith({
        where: { programId: 'p-1', weekIndex: [0], dayIndex: 3 },
        transaction: fakeTx,
      });
      expect(workoutModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ weekIndex: 0, dayIndex: 3 }),
        { transaction: fakeTx },
      );
    });

    it('refuses a different day across several weeks', async () => {
      // Ambiguous: it would mean "which day?" once per week.
      owned();
      await expect(
        service.copyDay(
          'p-1',
          {
            fromWeekIndex: 0,
            dayIndex: 1,
            toWeekIndexes: [1, 2],
            toDayIndex: 3,
          },
          'me',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(workoutModel.findOne).not.toHaveBeenCalled();
    });

    it('still refuses a copy onto the very same slot', async () => {
      owned();
      await expect(
        service.copyDay(
          'p-1',
          { fromWeekIndex: 0, dayIndex: 1, toWeekIndexes: [0], toDayIndex: 1 },
          'me',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('ignores a week listed twice', async () => {
      owned();
      workoutModel.findOne.mockResolvedValueOnce(sourceDay);
      workoutModel.findAll.mockResolvedValueOnce([]);
      workoutModel.create.mockResolvedValueOnce({ id: 'w-d2' });
      prescribedExerciseModel.create.mockResolvedValueOnce({ id: 'e-1' });

      await service.copyDay(
        'p-1',
        { fromWeekIndex: 0, dayIndex: 1, toWeekIndexes: [2, 2, 2] },
        'me',
      );

      expect(workoutModel.create).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Repeat the built weeks into the empty ones after them ───────

  describe('repeatWeeks', () => {
    const program = (durationDays: number | null) => ({
      id: 'p-1',
      ownerId: 'me',
      isSingleWorkout: false,
      durationDays,
    });
    const day = (weekIndex: number, dayIndex: number, name: string) => ({
      name,
      weekIndex,
      dayIndex,
      sequenceNumber: 0,
      exercises: [],
    });

    it('cycles the built block through the empty weeks after it', async () => {
      programModel.findByPk
        .mockResolvedValueOnce(program(35)) // five weeks
        .mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findAll
        .mockResolvedValueOnce([day(0, 0, 'A'), day(1, 2, 'B')]) // block = weeks 1–2
        .mockResolvedValueOnce([]); // renumbering pass
      workoutModel.create
        .mockResolvedValueOnce({ id: 'w-3' })
        .mockResolvedValueOnce({ id: 'w-4' })
        .mockResolvedValueOnce({ id: 'w-5' });

      await service.repeatWeeks('p-1', 'me');

      const created = workoutModel.create.mock.calls.map(
        ([row]: [{ name: string; weekIndex: number; dayIndex: number }]) =>
          `${row.name}@${row.weekIndex}:${row.dayIndex}`,
      );
      expect(created).toEqual(['A@2:0', 'B@3:2', 'A@4:0']);
    });

    it('writes nothing when the built weeks already fill the length', async () => {
      programModel.findByPk
        .mockResolvedValueOnce(program(14))
        .mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findAll.mockResolvedValueOnce([
        day(0, 0, 'A'),
        day(1, 0, 'B'),
      ]);

      await service.repeatWeeks('p-1', 'me');

      expect(workoutModel.create).not.toHaveBeenCalled();
    });

    it('needs a length to know how far to repeat', async () => {
      programModel.findByPk.mockResolvedValueOnce(program(null));
      await expect(service.repeatWeeks('p-1', 'me')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── Delete one week and close the gap ───────────────────────────

  describe('deleteWeek', () => {
    const program = (durationDays: number, update = jest.fn()) => ({
      id: 'p-1',
      ownerId: 'me',
      isSingleWorkout: false,
      durationDays,
      update,
    });

    it('removes the week, moves later weeks up and shortens the program', async () => {
      const update = jest.fn();
      programModel.findByPk
        .mockResolvedValueOnce(program(28, update))
        .mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findAll
        .mockResolvedValueOnce([
          { id: 'a', weekIndex: 0 },
          { id: 'b', weekIndex: 1 },
          { id: 'c', weekIndex: 3 },
          { id: 'd', weekIndex: 3 },
        ])
        .mockResolvedValueOnce([]); // renumbering pass
      assignmentModel.count.mockResolvedValueOnce(0);

      await service.deleteWeek('p-1', 1, 'me');

      expect(workoutModel.destroy).toHaveBeenCalledWith({
        where: { programId: 'p-1', weekIndex: 1 },
        transaction: fakeTx,
      });
      // Only week 4 holds work after the deleted one; it becomes week 3.
      expect(workoutModel.update).toHaveBeenCalledTimes(1);
      expect(workoutModel.update).toHaveBeenCalledWith(
        { weekIndex: 2 },
        { where: { programId: 'p-1', weekIndex: 3 }, transaction: fakeTx },
      );
      expect(update).toHaveBeenCalledWith(
        { durationDays: 21 },
        { transaction: fakeTx },
      );
    });

    it('refuses while clients are still training that week', async () => {
      programModel.findByPk.mockResolvedValueOnce(program(28));
      workoutModel.findAll.mockResolvedValueOnce([{ id: 'b', weekIndex: 1 }]);
      assignmentModel.count.mockResolvedValueOnce(2);

      await expect(service.deleteWeek('p-1', 1, 'me')).rejects.toThrow(
        ConflictException,
      );
      expect(workoutModel.destroy).not.toHaveBeenCalled();
    });

    it('refuses to delete the only week', async () => {
      programModel.findByPk.mockResolvedValueOnce(program(7));
      workoutModel.findAll.mockResolvedValueOnce([{ id: 'a', weekIndex: 0 }]);

      await expect(service.deleteWeek('p-1', 0, 'me')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── Workouts round 2: rest defaults, supersets, archive ─────────

  describe('rest defaults in the builders', () => {
    it("saves a routine's rest between sets", async () => {
      programModel.create.mockResolvedValueOnce({ id: 'p-new' });

      await service.create(
        { name: 'Upper A', defaultRestSeconds: 120 },
        'me',
        false,
      );

      expect(programModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ defaultRestSeconds: 120 }),
      );
    });

    it('changes it, and clears it with null', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      programModel.findByPk.mockResolvedValue({
        id: 'p-1',
        ownerId: 'me',
        isSingleWorkout: true,
        update,
      });

      await service.update('p-1', { defaultRestSeconds: 90 }, 'me');
      await service.update('p-1', { defaultRestSeconds: null }, 'me');
      await service.update('p-1', { name: 'Upper B' }, 'me');

      expect(
        (update.mock.calls as unknown[][]).map(([fields]) => fields),
      ).toEqual([
        { defaultRestSeconds: 90 },
        { defaultRestSeconds: null },
        { name: 'Upper B' },
      ]);
      programModel.findByPk.mockReset();
    });

    it("sets a coach day's rest", async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce({
        id: 'w-1',
        weekIndex: 0,
        dayIndex: 0,
        update,
      });

      await service.updateWorkout(
        'p-1',
        'w-1',
        { defaultRestSeconds: 150 },
        'me',
      );

      expect(update).toHaveBeenCalledWith({ defaultRestSeconds: 150 });
    });

    it("writes an exercise's rest to every one of its sets, in one transaction", async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce({
        id: 'w-1',
        programId: 'p-1',
      });
      prescribedExerciseModel.findOne.mockResolvedValueOnce({
        id: 'e-1',
        exerciseId: 'ex-1',
        supersetGroupId: null,
        update,
      });

      await service.updateExercise(
        'p-1',
        'w-1',
        'e-1',
        { restAfterSeconds: 120 },
        'me',
      );

      expect(prescribedSetModel.update).toHaveBeenCalledWith(
        { restAfterSeconds: 120 },
        { where: { prescribedExerciseId: 'e-1' }, transaction: fakeTx },
      );
      expect(update).toHaveBeenCalledWith({}, { transaction: fakeTx });
    });

    it('carries the rest onto the empty sets added with an exercise', async () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce({
        id: 'w-1',
        programId: 'p-1',
      });
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'ex-1',
        source: ExerciseSource.System,
        visibility: ExerciseVisibility.Public,
        ownerId: null,
      });
      prescribedExerciseModel.max.mockResolvedValueOnce(null);
      prescribedExerciseModel.create.mockResolvedValueOnce({ id: 'e-new' });

      await service.addExercise(
        'p-1',
        'w-1',
        { exerciseId: 'ex-1', defaultSets: 2, restAfterSeconds: 90 },
        'me',
      );

      const [rows] = prescribedSetModel.bulkCreate.mock.calls[0] as [
        { restAfterSeconds: number | null }[],
      ];
      expect(rows.map((r) => r.restAfterSeconds)).toEqual([90, 90]);
    });

    it('copies the rest defaults with a duplicate', async () => {
      programModel.findOne.mockResolvedValueOnce({
        id: 'p-src',
        ownerId: 'me',
        source: 'USER',
        name: 'Upper A',
        defaultRestSeconds: 90,
        workouts: [
          {
            name: 'Day 1',
            weekIndex: 0,
            dayIndex: 0,
            sequenceNumber: 0,
            defaultRestSeconds: 150,
            exercises: [],
          },
        ],
      });
      programModel.create.mockResolvedValueOnce({ id: 'p-copy' });
      workoutModel.create.mockResolvedValueOnce({ id: 'w-copy' });

      await service.duplicateForUser('p-src', 'me');

      expect(programModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ defaultRestSeconds: 90 }),
        expect.anything(),
      );
      expect(workoutModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ defaultRestSeconds: 150 }),
        expect.anything(),
      );
    });

    it("copies a day's rest with copy-week", async () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findAll
        .mockResolvedValueOnce([
          {
            name: 'Day 1',
            notes: null,
            dayIndex: 0,
            sequenceNumber: 0,
            phase: null,
            estimatedDurationMinutes: 45,
            defaultRestSeconds: 120,
            exercises: [],
          },
        ])
        .mockResolvedValueOnce([]); // resequence
      workoutModel.create.mockResolvedValueOnce({ id: 'w-new' });

      await service.copyWeek('p-1', { fromWeekIndex: 0, toWeekIndex: 1 }, 'me');

      expect(workoutModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ weekIndex: 1, defaultRestSeconds: 120 }),
        { transaction: fakeTx },
      );
    });
  });

  describe('supersets in the builders', () => {
    const slot = (fields: Record<string, unknown> = {}) => ({
      id: 'e-a1',
      exerciseId: 'ex-1',
      supersetGroupId: 1,
      update: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn().mockResolvedValue(undefined),
      ...fields,
    });
    const loadSlot = (row: ReturnType<typeof slot>) => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce({
        id: 'w-1',
        programId: 'p-1',
      });
      prescribedExerciseModel.findOne.mockResolvedValueOnce(row);
    };

    it('unlinks with null, and the partner left alone goes standalone too', async () => {
      const row = slot();
      loadSlot(row);
      prescribedExerciseModel.findAll.mockResolvedValueOnce([{ id: 'e-a2' }]);

      await service.updateExercise(
        'p-1',
        'w-1',
        'e-a1',
        { supersetGroupId: null },
        'me',
      );

      expect(row.update).toHaveBeenCalledWith(
        { supersetGroupId: null },
        { transaction: fakeTx },
      );
      expect(prescribedExerciseModel.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { programWorkoutId: 'w-1', supersetGroupId: 1 },
          transaction: fakeTx,
        }),
      );
      expect(prescribedExerciseModel.update).toHaveBeenCalledWith(
        { supersetGroupId: null },
        { where: { id: 'e-a2' }, transaction: fakeTx },
      );
    });

    it('links two exercises without touching any other group', async () => {
      const row = slot({ supersetGroupId: null });
      loadSlot(row);

      await service.updateExercise(
        'p-1',
        'w-1',
        'e-a1',
        { supersetGroupId: 2 },
        'me',
      );

      expect(row.update).toHaveBeenCalledWith(
        { supersetGroupId: 2 },
        { transaction: fakeTx },
      );
      expect(prescribedExerciseModel.findAll).not.toHaveBeenCalled();
    });

    it('removing one of a pair unlinks the other, in the same transaction', async () => {
      const row = slot();
      loadSlot(row);
      prescribedExerciseModel.findAll.mockResolvedValueOnce([{ id: 'e-a2' }]);

      await service.removeExercise('p-1', 'w-1', 'e-a1', 'me');

      expect(row.destroy).toHaveBeenCalledWith({ transaction: fakeTx });
      expect(prescribedExerciseModel.update).toHaveBeenCalledWith(
        { supersetGroupId: null },
        { where: { id: 'e-a2' }, transaction: fakeTx },
      );
    });

    it('keeps a superset of three linked when one is removed', async () => {
      loadSlot(slot());
      prescribedExerciseModel.findAll.mockResolvedValueOnce([
        { id: 'e-a2' },
        { id: 'e-a3' },
      ]);

      await service.removeExercise('p-1', 'w-1', 'e-a1', 'me');

      expect(prescribedExerciseModel.update).not.toHaveBeenCalled();
    });

    it('writes a superset the routine editor left with one exercise as standalone', async () => {
      programModel.create.mockResolvedValueOnce({ id: 'p-new' });
      workoutModel.create.mockResolvedValueOnce({ id: 'w-new' });
      prescribedExerciseModel.create.mockResolvedValue({ id: 'e-x' });

      await service.create(
        {
          name: 'Upper A',
          isSingleWorkout: true,
          exercises: [
            { exerciseId: 'ex-1', supersetGroupId: 1 },
            { exerciseId: 'ex-2', supersetGroupId: 1 },
            { exerciseId: 'ex-3', supersetGroupId: 2 },
          ],
        },
        'me',
        false,
      );

      const groups = prescribedExerciseModel.create.mock.calls.map(
        ([row]) => (row as { supersetGroupId: number | null }).supersetGroupId,
      );
      expect(groups).toEqual([1, 1, null]);
      prescribedExerciseModel.create.mockReset();
    });
  });

  describe('list — archived routines and programs', () => {
    const statusOf = () =>
      (
        (programModel.findAndCountAll.mock.calls as unknown[][])[0][0] as {
          where: Record<string, unknown>;
        }
      ).where['status'];

    beforeEach(() => {
      programModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
      prescribedExerciseModel.findAll.mockResolvedValue([]);
    });

    it('keeps every status by default, as the web expects', async () => {
      await service.list({ isSingleWorkout: true }, 'me');
      expect(statusOf()).toBeUndefined();
    });

    it('leaves archived ones out where a routine is picked to start', async () => {
      await service.list(
        { isSingleWorkout: true, archived: ProgramArchivedFilter.Exclude },
        'me',
      );
      expect(statusOf()).toEqual({ [Op.in]: ['DRAFT', 'PUBLISHED'] });
    });

    it('lists archived ones alone, to restore one', async () => {
      await service.list(
        { isSingleWorkout: true, archived: ProgramArchivedFilter.Only },
        'me',
      );
      expect(statusOf()).toEqual({ [Op.in]: ['ARCHIVED'] });
    });

    it('narrows a status sent beside it', async () => {
      await service.list(
        { status: 'DRAFT', archived: ProgramArchivedFilter.Only },
        'me',
      );
      expect(statusOf()).toEqual({ [Op.in]: [] });
    });

    it('keeps a lone status filter as it was', async () => {
      await service.list({ status: 'ARCHIVED' }, 'me');
      expect(statusOf()).toBe('ARCHIVED');
    });
  });

  describe('archiving a routine', () => {
    it('archives and restores through the status, like a coach program', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      programModel.findByPk.mockResolvedValue({
        id: 'r-1',
        ownerId: 'me',
        source: 'USER',
        isSingleWorkout: true,
        update,
      });

      await service.update('r-1', { status: 'ARCHIVED' }, 'me');
      await service.update('r-1', { status: 'DRAFT' }, 'me');

      expect(
        (update.mock.calls as unknown[][]).map(([fields]) => fields),
      ).toEqual([{ status: 'ARCHIVED' }, { status: 'DRAFT' }]);
      programModel.findByPk.mockReset();
    });
  });
});
