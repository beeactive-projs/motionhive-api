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

  const assignmentModel = {
    count: jest.fn(),
    update: jest.fn(),
    // No clients unless a test says so: the list and detail reads ask.
    findAll: jest.fn().mockResolvedValue([]),
  };
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
    count: jest.fn(),
  };
  const prescribedSetModel = {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    destroy: jest.fn(),
    bulkCreate: jest.fn(),
    max: jest.fn(),
  };
  const exerciseModel = { findByPk: jest.fn(), findAll: jest.fn() };

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
      workoutModel.findAll.mockResolvedValueOnce([
        { programId: 'p-1', total: '3' },
      ]);
      assignmentModel.findAll.mockResolvedValueOnce([
        { programId: 'p-2', total: '2' },
      ]);

      const res = await service.list({ isSingleWorkout: true }, 'me');

      expect(res.items).toEqual([
        expect.objectContaining({
          id: 'p-1',
          exerciseCount: 3,
          daysPerWeek: 3,
          clientCount: 0,
        }),
        expect.objectContaining({
          id: 'p-2',
          exerciseCount: 0,
          daysPerWeek: 0,
          clientCount: 2,
        }),
      ]);
    });

    it("counts the caller's own clients who still follow it, once each", async () => {
      programModel.findAndCountAll.mockResolvedValueOnce({
        rows: [{ id: 'p-1', toJSON: () => ({ id: 'p-1' }) }],
        count: 1,
      });
      prescribedExerciseModel.findAll.mockResolvedValueOnce([]);
      workoutModel.findAll.mockResolvedValueOnce([]);

      await service.list({}, 'coach-1');

      const query = assignmentModel.findAll.mock.calls[0][0] as {
        where: Record<string, unknown>;
        group: unknown[];
      };
      // A starter is in every coach's library: only this coach's clients
      // count, and a person's own schedules (no coach) never do.
      expect(query.where).toEqual({
        masterProgramId: { [Op.in]: ['p-1'] },
        instructorId: 'coach-1',
        status: { [Op.in]: ['PENDING', 'ACTIVE', 'PAUSED'] },
      });
      expect(query.group).toHaveLength(1);
    });

    it('skips the count query entirely when the page is empty', async () => {
      programModel.findAndCountAll.mockResolvedValueOnce({
        rows: [],
        count: 0,
      });

      const res = await service.list({}, 'me');

      expect(res.items).toEqual([]);
      expect(prescribedExerciseModel.findAll).not.toHaveBeenCalled();
      expect(workoutModel.findAll).not.toHaveBeenCalled();
      expect(assignmentModel.findAll).not.toHaveBeenCalled();
    });
  });

  describe('findDetail — the tree with the row counts', () => {
    it('says how many clients follow it, beside its days and exercises', async () => {
      const tree = {
        id: 'p-1',
        ownerId: 'me',
        source: 'INSTRUCTOR',
        workouts: [
          { dayIndex: 0, exercises: [{}, {}] },
          { dayIndex: 2, exercises: [{}] },
          { dayIndex: 0, exercises: [] },
        ],
      };
      programModel.findByPk.mockResolvedValueOnce({
        ...tree,
        toJSON: () => tree,
      });
      assignmentModel.findAll.mockResolvedValueOnce([
        { programId: 'p-1', total: '3' },
      ]);

      const res = await service.findDetail('p-1', 'me');

      expect(res).toEqual(
        expect.objectContaining({
          id: 'p-1',
          exerciseCount: 3,
          daysPerWeek: 2,
          clientCount: 3,
        }),
      );
      expect(
        (assignmentModel.findAll.mock.calls[0][0] as { where: object }).where,
      ).toEqual(expect.objectContaining({ instructorId: 'me' }));
    });

    it('still hides a program that is not yours', async () => {
      programModel.findByPk.mockResolvedValueOnce({
        id: 'p-1',
        ownerId: 'someone-else',
        source: 'INSTRUCTOR',
      });

      await expect(service.findDetail('p-1', 'me')).rejects.toThrow(
        NotFoundException,
      );
      expect(assignmentModel.findAll).not.toHaveBeenCalled();
    });
  });

  // ─── update — routine tree replacement ───────────────────────────

  describe('setSupersets — a program day, in one transaction', () => {
    const owned = () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce({
        id: 'pw-1',
        programId: 'p-1',
      });
    };

    it('writes one update per group, then undoes a superset left alone', async () => {
      owned();
      prescribedExerciseModel.findAll
        // every id is an exercise of this day
        .mockResolvedValueOnce([
          { id: 'c' },
          { id: 'd' },
          { id: 'e' },
          { id: 'f' },
        ])
        // after the writes: group 2 = C, D; group 3 = E only
        .mockResolvedValueOnce([
          { id: 'c', supersetGroupId: 2 },
          { id: 'd', supersetGroupId: 2 },
          { id: 'e', supersetGroupId: 3 },
        ]);

      await service.setSupersets(
        'p-1',
        'pw-1',
        [
          { id: 'c', supersetGroupId: 2 },
          { id: 'd', supersetGroupId: 2 },
          { id: 'e', supersetGroupId: 3 },
          { id: 'f', supersetGroupId: null },
        ],
        'me',
      );

      expect(prescribedExerciseModel.update).toHaveBeenCalledWith(
        { supersetGroupId: 2 },
        {
          where: { id: ['c', 'd'], programWorkoutId: 'pw-1' },
          transaction: fakeTx,
        },
      );
      expect(prescribedExerciseModel.update).toHaveBeenCalledWith(
        { supersetGroupId: null },
        { where: { id: ['f'], programWorkoutId: 'pw-1' }, transaction: fakeTx },
      );
      expect(prescribedExerciseModel.update).toHaveBeenCalledWith(
        { supersetGroupId: null },
        { where: { id: ['e'] }, transaction: fakeTx },
      );
    });

    it('changes nothing when an id is not an exercise of the day', async () => {
      owned();
      prescribedExerciseModel.findAll.mockResolvedValueOnce([{ id: 'c' }]);

      await expect(
        service.setSupersets(
          'p-1',
          'pw-1',
          [
            { id: 'c', supersetGroupId: 1 },
            { id: 'someone-elses', supersetGroupId: 1 },
          ],
          'me',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prescribedExerciseModel.update).not.toHaveBeenCalled();
    });
  });

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

    it("renames a routine's one workout with it, in one transaction", async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      programModel.findByPk.mockResolvedValueOnce({
        id: 'p-5',
        ownerId: 'me',
        isSingleWorkout: true,
        update,
      });

      await service.update('p-5', { name: '  Push B ' }, 'me');

      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Push B' }),
        { transaction: fakeTx },
      );
      expect(workoutModel.update).toHaveBeenCalledWith(
        { name: 'Push B' },
        { where: { programId: 'p-5' }, transaction: fakeTx },
      );
    });

    it("leaves a program's day names alone on a rename", async () => {
      programModel.findByPk.mockResolvedValueOnce({
        id: 'p-6',
        ownerId: 'me',
        isSingleWorkout: false,
        update: jest.fn().mockResolvedValue(undefined),
      });

      await service.update('p-6', { name: 'Block 2' }, 'me');

      expect(workoutModel.update).not.toHaveBeenCalled();
    });

    it('drops the weeks a shortened program no longer has room for', async () => {
      programModel.findByPk.mockResolvedValueOnce({
        id: 'p-3',
        ownerId: 'me',
        isSingleWorkout: false,
        update: jest.fn().mockResolvedValue(undefined),
      });
      workoutModel.count.mockResolvedValueOnce(2); // week 3+ holds work

      await service.update('p-3', { durationDays: 21 }, 'me');

      // 21 days = 3 weeks, so weeks 3 and up go.
      expect(workoutModel.destroy).toHaveBeenCalledWith({
        where: { programId: 'p-3', weekIndex: { [Op.gte]: 3 } },
      });
    });

    it('shortens a program clients follow: they keep their own copy', async () => {
      programModel.findByPk.mockResolvedValueOnce({
        id: 'p-4',
        ownerId: 'me',
        isSingleWorkout: false,
        update: jest.fn().mockResolvedValue(undefined),
      });
      workoutModel.count.mockResolvedValueOnce(3);

      await service.update('p-4', { durationDays: 7 }, 'me');

      // No roster check: an assigned copy is its own rows.
      expect(assignmentModel.count).not.toHaveBeenCalled();
      expect(workoutModel.destroy).toHaveBeenCalledWith({
        where: { programId: 'p-4', weekIndex: { [Op.gte]: 1 } },
      });
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

  // ─── Publishing needs a name and a day with exercises ────────────

  describe('publishing — the program has to be ready', () => {
    const draft = (overrides: Record<string, unknown> = {}) => ({
      id: 'p-1',
      ownerId: 'me',
      name: 'Strength base',
      status: 'DRAFT',
      isSingleWorkout: false,
      update: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    });

    it.each(['Untitled program', 'Program fără titlu', '  Untitled program '])(
      'refuses the name a new draft is born with (%s)',
      async (name) => {
        const program = draft({ name });
        programModel.findByPk.mockResolvedValueOnce(program);

        await expect(
          service.update('p-1', { status: 'PUBLISHED' }, 'me'),
        ).rejects.toMatchObject({
          response: { messageKey: 'workout.cannotPublishWithoutName' },
        });
        expect(program.update).not.toHaveBeenCalled();
      },
    );

    it('takes a new name sent in the same request', async () => {
      const program = draft({ name: 'Untitled program' });
      programModel.findByPk.mockResolvedValueOnce(program);
      prescribedExerciseModel.count.mockResolvedValueOnce(4);

      await service.update(
        'p-1',
        { name: 'Hypertrophy block', status: 'PUBLISHED' },
        'me',
      );

      expect(program.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PUBLISHED' }),
        expect.anything(),
      );
    });

    it('refuses a program whose days hold no exercises', async () => {
      const program = draft();
      programModel.findByPk.mockResolvedValueOnce(program);
      // Day rows may exist, but none has an exercise in it.
      prescribedExerciseModel.count.mockResolvedValueOnce(0);

      await expect(
        service.update('p-1', { status: 'PUBLISHED' }, 'me'),
      ).rejects.toMatchObject({
        response: {
          messageKey: 'workout.cannotPublishWithoutExercises',
          messageParams: { kind: 'program' },
        },
      });
      expect(program.update).not.toHaveBeenCalled();
    });

    it('publishes a named program with a day of exercises', async () => {
      const program = draft();
      programModel.findByPk.mockResolvedValueOnce(program);
      prescribedExerciseModel.count.mockResolvedValueOnce(5);

      await service.update('p-1', { status: 'PUBLISHED' }, 'me');

      expect(prescribedExerciseModel.count).toHaveBeenCalledWith({
        include: [
          expect.objectContaining({
            as: 'workout',
            where: { programId: 'p-1' },
          }),
        ],
      });
      expect(program.update).toHaveBeenCalledWith(
        { status: 'PUBLISHED' },
        expect.anything(),
      );
    });

    it('counts only the weeks a length sent beside it keeps', async () => {
      programModel.findByPk.mockResolvedValueOnce(draft());
      prescribedExerciseModel.count.mockResolvedValueOnce(0);

      await expect(
        service.update('p-1', { status: 'PUBLISHED', durationDays: 14 }, 'me'),
      ).rejects.toThrow(BadRequestException);
      expect(prescribedExerciseModel.count).toHaveBeenCalledWith({
        include: [
          expect.objectContaining({
            where: { programId: 'p-1', weekIndex: { [Op.lt]: 2 } },
          }),
        ],
      });
      // Refused before the shorter length dropped anything.
      expect(workoutModel.destroy).not.toHaveBeenCalled();
    });

    it('publishes a routine sent with its exercises, without a count', async () => {
      const routine = draft({ isSingleWorkout: true, name: 'Full body 45' });
      programModel.findByPk.mockResolvedValueOnce(routine);
      workoutModel.findOne.mockResolvedValueOnce({ id: 'pw-1' });
      prescribedExerciseModel.create.mockResolvedValueOnce({ id: 'pe-1' });

      await service.update(
        'p-1',
        { status: 'PUBLISHED', exercises: [{ exerciseId: 'ex-1' }] },
        'me',
      );

      expect(prescribedExerciseModel.count).not.toHaveBeenCalled();
      expect(routine.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PUBLISHED' }),
        expect.anything(),
      );
    });

    it('calls an empty routine a routine', async () => {
      programModel.findByPk.mockResolvedValueOnce(
        draft({ isSingleWorkout: true }),
      );

      await expect(
        service.update('p-1', { status: 'PUBLISHED', exercises: [] }, 'me'),
      ).rejects.toMatchObject({
        response: { messageParams: { kind: 'routine' } },
      });
    });

    it('does not re-check a program that is already published', async () => {
      const program = draft({ status: 'PUBLISHED', name: 'Untitled program' });
      programModel.findByPk.mockResolvedValueOnce(program);

      await service.update('p-1', { status: 'PUBLISHED' }, 'me');

      expect(prescribedExerciseModel.count).not.toHaveBeenCalled();
      expect(program.update).toHaveBeenCalled();
    });

    it('leaves the other moves alone: back to draft, archive', async () => {
      const program = draft({ name: 'Untitled program' });
      programModel.findByPk.mockResolvedValue(program);

      await service.update('p-1', { status: 'DRAFT' }, 'me');
      await service.update('p-1', { status: 'ARCHIVED' }, 'me');

      expect(prescribedExerciseModel.count).not.toHaveBeenCalled();
      expect(program.update).toHaveBeenCalledTimes(2);
      programModel.findByPk.mockReset();
    });

    it('creates a routine as published when it comes with exercises', async () => {
      programModel.create.mockResolvedValueOnce({ id: 'p-new' });
      workoutModel.create.mockResolvedValueOnce({ id: 'pw-new' });
      prescribedExerciseModel.create.mockResolvedValueOnce({ id: 'pe-new' });

      await service.create(
        {
          name: 'Push day',
          isSingleWorkout: true,
          status: 'PUBLISHED',
          exercises: [{ exerciseId: 'ex-1' }],
        },
        'me',
        true,
      );

      expect(programModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'PUBLISHED' }),
        expect.anything(),
      );
    });

    it('never creates a multi-week program as published: it has no days yet', async () => {
      await expect(
        service.create({ name: 'Block', status: 'PUBLISHED' }, 'me', true),
      ).rejects.toMatchObject({
        response: { messageKey: 'workout.cannotPublishWithoutExercises' },
      });
      expect(programModel.create).not.toHaveBeenCalled();
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

  /** What the detail read after a week edit loads: yours, with no days. */
  const detail = {
    id: 'p-1',
    ownerId: 'me',
    workouts: [],
    toJSON: () => ({ id: 'p-1', workouts: [] }),
  };

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
        .mockResolvedValueOnce(detail);
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
        .mockResolvedValueOnce(detail);
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
        .mockResolvedValueOnce(detail);
      workoutModel.findAll
        .mockResolvedValueOnce([
          { id: 'a', weekIndex: 0 },
          { id: 'b', weekIndex: 1 },
          { id: 'c', weekIndex: 3 },
          { id: 'd', weekIndex: 3 },
        ])
        .mockResolvedValueOnce([]); // renumbering pass

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

    it('deletes a week clients still follow: they keep their own copy', async () => {
      programModel.findByPk
        .mockResolvedValueOnce(program(28))
        .mockResolvedValueOnce(detail);
      workoutModel.findAll
        .mockResolvedValueOnce([{ id: 'b', weekIndex: 1 }])
        .mockResolvedValueOnce([]); // renumbering pass
      // Two clients follow it; the delete does not ask.
      assignmentModel.findAll.mockResolvedValueOnce([
        { programId: 'p-1', total: '2' },
      ]);

      const result = await service.deleteWeek('p-1', 1, 'me');

      expect(assignmentModel.count).not.toHaveBeenCalled();
      expect(workoutModel.destroy).toHaveBeenCalledWith({
        where: { programId: 'p-1', weekIndex: 1 },
        transaction: fakeTx,
      });
      expect(result.clientCount).toBe(2);
    });

    it('refuses to delete the only week', async () => {
      programModel.findByPk.mockResolvedValueOnce(program(7));
      workoutModel.findAll.mockResolvedValueOnce([{ id: 'a', weekIndex: 0 }]);

      await expect(service.deleteWeek('p-1', 0, 'me')).rejects.toThrow(
        BadRequestException,
      );
    });

    it("hides a MotionHive starter: it is nobody's to change", async () => {
      programModel.findByPk.mockResolvedValueOnce({
        ...program(28),
        ownerId: null,
        source: ProgramSource.System,
      });

      await expect(service.deleteWeek('p-1', 1, 'me')).rejects.toThrow(
        NotFoundException,
      );
      expect(workoutModel.destroy).not.toHaveBeenCalled();
    });
  });

  // ─── Copy one week into several ─────────────────────────────────

  describe('copyWeek — several target weeks', () => {
    const sourceWeek = [
      { name: 'Push', dayIndex: 0, sequenceNumber: 0, exercises: [] },
      { name: 'Pull', dayIndex: 2, sequenceNumber: 1, exercises: [] },
    ];

    it('copies into every week listed, once each, in one transaction', async () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findAll
        .mockResolvedValueOnce(sourceWeek)
        .mockResolvedValueOnce([]); // renumbering pass
      workoutModel.create
        .mockResolvedValueOnce({ id: 'w-2a' })
        .mockResolvedValueOnce({ id: 'w-2b' })
        .mockResolvedValueOnce({ id: 'w-3a' })
        .mockResolvedValueOnce({ id: 'w-3b' });

      const copied = await service.copyWeek(
        'p-1',
        { fromWeekIndex: 0, toWeekIndexes: [2, 3, 3, 0] },
        'me',
      );

      // The source week drops out and the repeat counts once.
      expect(workoutModel.destroy).toHaveBeenCalledTimes(1);
      expect(workoutModel.destroy).toHaveBeenCalledWith({
        where: { programId: 'p-1', weekIndex: [2, 3] },
        transaction: fakeTx,
      });
      expect(workoutModel.create).toHaveBeenCalledTimes(4);
      expect(workoutModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Pull', weekIndex: 3, dayIndex: 2 }),
        { transaction: fakeTx },
      );
      expect(copied.map((w) => w.id)).toEqual(['w-2a', 'w-2b', 'w-3a', 'w-3b']);
    });

    it('refuses a list that holds only the source week', async () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });

      await expect(
        service.copyWeek('p-1', { fromWeekIndex: 1, toWeekIndexes: [1] }, 'me'),
      ).rejects.toThrow(BadRequestException);
      expect(workoutModel.findAll).not.toHaveBeenCalled();
    });
  });

  // ─── Add a week after one ────────────────────────────────────────

  describe('insertWeekAfter', () => {
    const program = (
      durationDays: number | null,
      update = jest.fn(),
      isSingleWorkout = false,
    ) => ({
      id: 'p-1',
      ownerId: 'me',
      isSingleWorkout,
      durationDays,
      update,
    });

    it('moves the later weeks down, latest first, and grows the program by a week', async () => {
      const update = jest.fn();
      programModel.findByPk
        .mockResolvedValueOnce(program(28, update))
        .mockResolvedValueOnce(detail);
      workoutModel.findAll
        .mockResolvedValueOnce([
          { id: 'a', weekIndex: 0 },
          { id: 'b', weekIndex: 2 },
          { id: 'c', weekIndex: 3 },
          { id: 'd', weekIndex: 3 },
        ])
        .mockResolvedValueOnce([]); // renumbering pass

      await service.insertWeekAfter('p-1', 0, 'me');

      // Week 4 first, into the empty week 5; then week 3 into week 4.
      expect(workoutModel.update).toHaveBeenNthCalledWith(
        1,
        { weekIndex: 4 },
        { where: { programId: 'p-1', weekIndex: 3 }, transaction: fakeTx },
      );
      expect(workoutModel.update).toHaveBeenNthCalledWith(
        2,
        { weekIndex: 3 },
        { where: { programId: 'p-1', weekIndex: 2 }, transaction: fakeTx },
      );
      expect(workoutModel.update).toHaveBeenCalledTimes(2);
      expect(update).toHaveBeenCalledWith(
        { durationDays: 35 },
        { transaction: fakeTx },
      );
    });

    it('gives an open-ended program the length its weeks reach, plus one', async () => {
      const update = jest.fn();
      programModel.findByPk
        .mockResolvedValueOnce(program(null, update))
        .mockResolvedValueOnce(detail);
      workoutModel.findAll
        .mockResolvedValueOnce([{ id: 'a', weekIndex: 1 }])
        .mockResolvedValueOnce([]);

      await service.insertWeekAfter('p-1', 1, 'me');

      // Nothing after week 2 to move.
      expect(workoutModel.update).not.toHaveBeenCalled();
      expect(update).toHaveBeenCalledWith(
        { durationDays: 21 },
        { transaction: fakeTx },
      );
    });

    it('refuses to grow past 104 weeks', async () => {
      programModel.findByPk.mockResolvedValueOnce(program(728));
      workoutModel.findAll.mockResolvedValueOnce([]);

      await expect(service.insertWeekAfter('p-1', 3, 'me')).rejects.toThrow(
        BadRequestException,
      );
      expect(workoutModel.update).not.toHaveBeenCalled();
    });

    it('404s past the last week', async () => {
      programModel.findByPk.mockResolvedValueOnce(program(14));
      workoutModel.findAll.mockResolvedValueOnce([]);

      await expect(service.insertWeekAfter('p-1', 2, 'me')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses a routine, which has no weeks', async () => {
      programModel.findByPk.mockResolvedValueOnce(
        program(null, jest.fn(), true),
      );

      await expect(service.insertWeekAfter('p-1', 0, 'me')).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── Clear a week ────────────────────────────────────────────────

  describe('clearWeek', () => {
    const program = (isSingleWorkout = false) => ({
      id: 'p-1',
      ownerId: 'me',
      isSingleWorkout,
      durationDays: 28,
      update: jest.fn(),
    });

    it("removes that week's days in one transaction and moves nothing", async () => {
      programModel.findByPk
        .mockResolvedValueOnce(program())
        .mockResolvedValueOnce(detail);
      workoutModel.findAll
        .mockResolvedValueOnce([
          { id: 'a', weekIndex: 0 },
          { id: 'b', weekIndex: 1 },
          { id: 'c', weekIndex: 1 },
        ])
        .mockResolvedValueOnce([]); // renumbering pass

      await service.clearWeek('p-1', 1, 'me');

      expect(workoutModel.destroy).toHaveBeenCalledTimes(1);
      expect(workoutModel.destroy).toHaveBeenCalledWith({
        where: { programId: 'p-1', weekIndex: 1 },
        transaction: fakeTx,
      });
      expect(workoutModel.update).not.toHaveBeenCalled();
    });

    it('changes nothing on a week already empty', async () => {
      programModel.findByPk
        .mockResolvedValueOnce(program())
        .mockResolvedValueOnce(detail);
      workoutModel.findAll.mockResolvedValueOnce([{ id: 'a', weekIndex: 0 }]);

      await service.clearWeek('p-1', 2, 'me');

      expect(workoutModel.destroy).not.toHaveBeenCalled();
    });

    it('refuses a routine, and 404s past the last week', async () => {
      programModel.findByPk.mockResolvedValueOnce(program(true));
      await expect(service.clearWeek('p-1', 0, 'me')).rejects.toThrow(
        BadRequestException,
      );

      programModel.findByPk.mockResolvedValueOnce(program());
      workoutModel.findAll.mockResolvedValueOnce([]);
      await expect(service.clearWeek('p-1', 4, 'me')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── Add several exercises at once ───────────────────────────────

  describe('addExercises — the picker in one request', () => {
    const chain = () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce({
        id: 'w-1',
        programId: 'p-1',
      });
    };
    const system = (id: string) => ({
      id,
      source: ExerciseSource.System,
      visibility: ExerciseVisibility.Public,
      ownerId: null,
    });

    it('appends them in order after the day, each with its sets, in one transaction', async () => {
      chain();
      exerciseModel.findAll.mockResolvedValueOnce([
        system('ex-a'),
        system('ex-b'),
      ]);
      prescribedExerciseModel.max.mockResolvedValueOnce(1); // two already
      prescribedExerciseModel.create
        .mockResolvedValueOnce({ id: 'pe-a' })
        .mockResolvedValueOnce({ id: 'pe-b' });

      const rows = await service.addExercises(
        'p-1',
        'w-1',
        {
          exercises: [
            { exerciseId: 'ex-a', defaultSets: 2, restAfterSeconds: 90 },
            { exerciseId: 'ex-b', defaultSets: 3 },
          ],
        },
        'me',
      );

      // One read checks every movement.
      expect(exerciseModel.findAll).toHaveBeenCalledTimes(1);
      expect(prescribedExerciseModel.create).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ exerciseId: 'ex-a', orderIndex: 2 }),
        { transaction: fakeTx },
      );
      expect(prescribedExerciseModel.create).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ exerciseId: 'ex-b', orderIndex: 3 }),
        { transaction: fakeTx },
      );
      expect(prescribedSetModel.bulkCreate).toHaveBeenNthCalledWith(
        1,
        [
          expect.objectContaining({
            prescribedExerciseId: 'pe-a',
            orderIndex: 0,
            restAfterSeconds: 90,
          }),
          expect.objectContaining({
            prescribedExerciseId: 'pe-a',
            orderIndex: 1,
            restAfterSeconds: 90,
          }),
        ],
        { transaction: fakeTx },
      );
      expect(prescribedSetModel.bulkCreate).toHaveBeenCalledTimes(2);
      expect(rows.map((row) => row.id)).toEqual(['pe-a', 'pe-b']);
    });

    it("adds none when one of them is another coach's private exercise", async () => {
      chain();
      exerciseModel.findAll.mockResolvedValueOnce([
        system('ex-a'),
        {
          id: 'ex-priv',
          source: ExerciseSource.Instructor,
          visibility: ExerciseVisibility.Private,
          ownerId: 'other-owner',
        },
      ]);

      await expect(
        service.addExercises(
          'p-1',
          'w-1',
          { exercises: [{ exerciseId: 'ex-a' }, { exerciseId: 'ex-priv' }] },
          'me',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prescribedExerciseModel.create).not.toHaveBeenCalled();
    });

    it('404s on an exercise that does not exist', async () => {
      chain();
      exerciseModel.findAll.mockResolvedValueOnce([]);

      await expect(
        service.addExercises(
          'p-1',
          'w-1',
          { exercises: [{ exerciseId: 'ex-gone' }] },
          'me',
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Set one exercise's sets, in place ───────────────────────────

  describe('setSets — matched by id, never rewritten', () => {
    const chain = () => {
      programModel.findByPk.mockResolvedValueOnce({ id: 'p-1', ownerId: 'me' });
      workoutModel.findOne.mockResolvedValueOnce({
        id: 'w-1',
        programId: 'p-1',
      });
      prescribedExerciseModel.findOne.mockResolvedValueOnce({
        id: 'pe-1',
        programWorkoutId: 'w-1',
      });
    };
    const row = (id: string) => ({ id, update: jest.fn() });

    it('updates the sets it knows in place, adds the new one, removes the one left out', async () => {
      chain();
      const first = row('s-1');
      const second = row('s-2');
      const dropped = row('s-3');
      prescribedSetModel.findAll
        .mockResolvedValueOnce([first, second, dropped])
        .mockResolvedValueOnce([first, second, { id: 's-new' }]);

      const sets = await service.setSets(
        'p-1',
        'w-1',
        'pe-1',
        {
          sets: [
            { id: 's-2', setType: 'WARMUP', targetRepsMin: 12 },
            {
              id: 's-1',
              targetRepsMin: 8,
              targetRepsMax: 10,
              targetWeightKg: 60,
            },
            { targetRepsMin: 8, targetRpe: 8, tempo: '3-1-1-0' },
          ],
        },
        'me',
      );

      expect(prescribedSetModel.destroy).toHaveBeenCalledWith({
        where: { id: ['s-3'] },
        transaction: fakeTx,
      });
      // The warm-up moved first, keeping its row; what it no longer has is cleared.
      expect(second.update).toHaveBeenCalledWith(
        expect.objectContaining({
          orderIndex: 0,
          setType: 'WARMUP',
          targetRepsMin: 12,
          targetWeightKg: null,
        }),
        { transaction: fakeTx },
      );
      expect(first.update).toHaveBeenCalledWith(
        expect.objectContaining({
          orderIndex: 1,
          setType: 'NORMAL',
          targetRepsMax: 10,
          targetWeightKg: 60,
        }),
        { transaction: fakeTx },
      );
      expect(prescribedSetModel.create).toHaveBeenCalledTimes(1);
      expect(prescribedSetModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          prescribedExerciseId: 'pe-1',
          orderIndex: 2,
          targetRpe: 8,
          tempo: '3-1-1-0',
        }),
        { transaction: fakeTx },
      );
      expect(sets).toHaveLength(3);
    });

    it('removes nothing when every set is sent back', async () => {
      chain();
      const only = row('s-1');
      prescribedSetModel.findAll
        .mockResolvedValueOnce([only])
        .mockResolvedValueOnce([only]);

      await service.setSets(
        'p-1',
        'w-1',
        'pe-1',
        { sets: [{ id: 's-1', targetRepsMin: 5 }] },
        'me',
      );

      expect(prescribedSetModel.destroy).not.toHaveBeenCalled();
      expect(prescribedSetModel.create).not.toHaveBeenCalled();
    });

    it('404s on a set of another exercise, changing nothing', async () => {
      chain();
      prescribedSetModel.findAll.mockResolvedValueOnce([row('s-1')]);

      await expect(
        service.setSets(
          'p-1',
          'w-1',
          'pe-1',
          { sets: [{ id: 's-1' }, { id: 's-other' }] },
          'me',
        ),
      ).rejects.toThrow(NotFoundException);
      expect(prescribedSetModel.destroy).not.toHaveBeenCalled();
      expect(prescribedSetModel.create).not.toHaveBeenCalled();
    });

    it('refuses a set sent twice', async () => {
      chain();

      await expect(
        service.setSets(
          'p-1',
          'w-1',
          'pe-1',
          { sets: [{ id: 's-1' }, { id: 's-1' }] },
          'me',
        ),
      ).rejects.toThrow(BadRequestException);
      expect(prescribedSetModel.findAll).not.toHaveBeenCalled();
    });

    it('refuses a set whose reps range runs backwards', async () => {
      chain();

      await expect(
        service.setSets(
          'p-1',
          'w-1',
          'pe-1',
          { sets: [{ targetRepsMin: 12, targetRepsMax: 8 }] },
          'me',
        ),
      ).rejects.toThrow(BadRequestException);
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
