import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
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
import { ProgramLibrary } from './dto/list-programs.query.dto';
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
    destroy: jest.fn(),
    max: jest.fn(),
  };
  const prescribedExerciseModel = {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    destroy: jest.fn(),
    max: jest.fn(),
  };
  const prescribedSetModel = {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
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

      const copied = await service.copyWeek(
        'p-1',
        { fromWeekIndex: 0, toWeekIndex: 2 },
        'me',
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
});
