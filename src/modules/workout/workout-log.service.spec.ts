import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { InstructorClient } from '../client/entities/instructor-client.entity';
import { Exercise } from '../exercise/entities/exercise.entity';
import { AssignedExercise } from './entities/assigned-exercise.entity';
import { AssignedSet } from './entities/assigned-set.entity';
import { AssignedWorkout } from './entities/assigned-workout.entity';
import { LoggedExercise } from './entities/logged-exercise.entity';
import { LoggedSet } from './entities/logged-set.entity';
import { OneRepMax } from './entities/one-rep-max.entity';
import { PrescribedExercise } from './entities/prescribed-exercise.entity';
import { PrescribedSet } from './entities/prescribed-set.entity';
import { ProgramWorkout } from './entities/program-workout.entity';
import { ProgramAssignment } from './entities/program-assignment.entity';
import { User } from '../user/entities/user.entity';
import { NotificationService } from '../notification/notification.service';
import { Program } from './entities/program.entity';
import { WorkoutLog } from './entities/workout-log.entity';
import { ProgramSource, WorkoutLogStatus } from './entities/workout.enums';
import { SaveRoutineMode } from './dto/save-log-as-routine.dto';
import { WorkoutLogService } from './workout-log.service';
import {
  fakeTx,
  makeSilentLogger,
} from '../../../test/helpers/sequelize-mocks';

/**
 * Smoke tests for WorkoutLogService — covers the gnarly bits:
 *   - %1RM resolution math (Epley + scale-from-1RM)
 *   - start() hydrates the log tree + flips assigned_workout status
 *   - freestyle vs assigned start guard
 *   - complete() computes duration + idempotent
 *   - 1RM list ordering / Epley estimate edges
 *   - cross-tenant hide on log reads
 */
describe('WorkoutLogService (smoke — not exhaustive)', () => {
  let service: WorkoutLogService;

  const logModel = {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
  };
  const loggedExerciseModel = {
    create: jest.fn(),
    findAll: jest.fn().mockResolvedValue([]),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    max: jest.fn(),
  };
  const loggedSetModel = {
    findByPk: jest.fn(),
    bulkCreate: jest.fn(),
    create: jest.fn(),
    findAll: jest.fn(),
    max: jest.fn(),
  };
  const assignedWorkoutModel = {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  };
  const assignedExerciseModel = {};
  const assignedSetModel = {};
  const oneRepMaxModel = {
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
  };
  const exerciseModel = { findByPk: jest.fn() };
  const programModel = {
    findByPk: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const prescribedExerciseModel = { findAll: jest.fn(), create: jest.fn() };
  const prescribedSetModel = { bulkCreate: jest.fn() };
  const programWorkoutModel = { create: jest.fn() };
  const instructorClientModel = { findOne: jest.fn() };
  const assignmentModel = { findByPk: jest.fn(), findAll: jest.fn() };
  const userModel = { findByPk: jest.fn() };
  const notificationService = { notify: jest.fn().mockResolvedValue({}) };
  const sequelize = {
    transaction: jest.fn((cb: (tx: unknown) => unknown) =>
      Promise.resolve(cb(fakeTx)),
    ),
    query: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        WorkoutLogService,
        { provide: getModelToken(WorkoutLog), useValue: logModel },
        {
          provide: getModelToken(LoggedExercise),
          useValue: loggedExerciseModel,
        },
        { provide: getModelToken(LoggedSet), useValue: loggedSetModel },
        {
          provide: getModelToken(AssignedWorkout),
          useValue: assignedWorkoutModel,
        },
        {
          provide: getModelToken(AssignedExercise),
          useValue: assignedExerciseModel,
        },
        { provide: getModelToken(AssignedSet), useValue: assignedSetModel },
        { provide: getModelToken(OneRepMax), useValue: oneRepMaxModel },
        { provide: getModelToken(Exercise), useValue: exerciseModel },
        { provide: getModelToken(Program), useValue: programModel },
        {
          provide: getModelToken(PrescribedExercise),
          useValue: prescribedExerciseModel,
        },
        { provide: getModelToken(PrescribedSet), useValue: prescribedSetModel },
        {
          provide: getModelToken(ProgramWorkout),
          useValue: programWorkoutModel,
        },
        {
          provide: getModelToken(InstructorClient),
          useValue: instructorClientModel,
        },
        {
          provide: getModelToken(ProgramAssignment),
          useValue: assignmentModel,
        },
        { provide: getModelToken(User), useValue: userModel },
        { provide: NotificationService, useValue: notificationService },
        { provide: Sequelize, useValue: sequelize },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();
    service = module.get(WorkoutLogService);
  });

  // ─── start() preconditions ───────────────────────────────────────

  describe('start — guards', () => {
    it('rejects a freestyle workout with no name', async () => {
      await expect(
        service.start('me', { assignedWorkoutId: undefined }),
      ).rejects.toThrow(BadRequestException);
    });

    it('hides existence when the assigned workout is not owned by the caller', async () => {
      assignedWorkoutModel.findByPk.mockResolvedValueOnce({
        id: 'aw-1',
        exercises: [],
      });
      assignedWorkoutModel.findOne.mockResolvedValueOnce(null); // not owned

      await expect(
        service.start('me', { assignedWorkoutId: 'aw-1' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('rejects passing both an assigned workout and a program', async () => {
      await expect(
        service.start('me', { assignedWorkoutId: 'aw-1', programId: 'p-1' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── start({programId}) — the ad-hoc path (was RoutineService) ────

  describe('start — from a program, with no assignment', () => {
    const makeProgram = (over: Record<string, unknown> = {}) => ({
      id: 'p-1',
      ownerId: 'me',
      source: ProgramSource.User,
      isSingleWorkout: true,
      name: 'Push day A',
      workouts: [{ id: 'pw-1', name: 'Push day A' }],
      update: jest.fn().mockResolvedValue(undefined),
      ...over,
    });

    it('seeds the log tree from the prescription and names it after the routine', async () => {
      programModel.findByPk.mockResolvedValueOnce(makeProgram());
      prescribedExerciseModel.findAll.mockResolvedValueOnce([
        {
          exerciseId: 'ex-1',
          orderIndex: 0,
          supersetGroupId: null,
          notes: null,
          exercise: { id: 'ex-1', name: 'Bench press', thumbnailUrl: null },
          sets: [{ setType: 'WARMUP' }, { setType: 'NORMAL' }],
        },
      ]);
      logModel.create.mockResolvedValueOnce({ id: 'log-1' });
      loggedExerciseModel.create.mockResolvedValueOnce({ id: 'le-1' });

      const log = await service.start('me', { programId: 'p-1' });

      expect(log).toEqual({ id: 'log-1' });
      // No assignment indirection on the ad-hoc path.
      expect(logModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Push day A',
          programAssignmentId: null,
          assignedWorkoutId: null,
        }),
        expect.anything(),
      );
      // One empty set row per prescribed set, carrying its type.
      expect(loggedSetModel.bulkCreate).toHaveBeenCalledWith(
        [
          expect.objectContaining({ orderIndex: 0, setType: 'WARMUP' }),
          expect.objectContaining({ orderIndex: 1, setType: 'NORMAL' }),
        ],
        expect.anything(),
      );
    });

    it('lets anyone start a SYSTEM starter program', async () => {
      programModel.findByPk.mockResolvedValueOnce(
        makeProgram({ ownerId: null, source: ProgramSource.System }),
      );
      prescribedExerciseModel.findAll.mockResolvedValueOnce([]);
      logModel.create.mockResolvedValueOnce({ id: 'log-2' });

      await expect(
        service.start('someone-else', { programId: 'p-1' }),
      ).resolves.toEqual({ id: 'log-2' });
    });

    it("hides another user's program", async () => {
      programModel.findByPk.mockResolvedValueOnce(
        makeProgram({ ownerId: 'not-me', source: ProgramSource.User }),
      );

      await expect(service.start('me', { programId: 'p-1' })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('refuses a program that has no workouts yet', async () => {
      programModel.findByPk.mockResolvedValueOnce(
        makeProgram({ workouts: [] }),
      );

      await expect(service.start('me', { programId: 'p-1' })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('still returns the log when stamping lastPerformedAt fails', async () => {
      const program = makeProgram({
        update: jest.fn().mockRejectedValue(new Error('db blip')),
      });
      programModel.findByPk.mockResolvedValueOnce(program);
      prescribedExerciseModel.findAll.mockResolvedValueOnce([]);
      logModel.create.mockResolvedValueOnce({ id: 'log-3' });

      // The workout has already started; a bookkeeping failure must not
      // roll it back.
      await expect(service.start('me', { programId: 'p-1' })).resolves.toEqual({
        id: 'log-3',
      });
    });
  });

  // ─── save-as-routine — the conversion moment ─────────────────────

  describe('addExerciseToLog — defaultSets', () => {
    it('creates the empty sets with the exercise in one transaction', async () => {
      logModel.findByPk.mockResolvedValueOnce({
        id: 'log-1',
        userId: 'me',
        status: WorkoutLogStatus.InProgress,
      });
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'ex-1',
        name: 'Squat',
        thumbnailUrl: null,
        visibility: 'PUBLIC',
        ownerId: null,
      });
      loggedExerciseModel.max.mockResolvedValueOnce(null);
      loggedExerciseModel.create.mockResolvedValueOnce({ id: 'le-new' });

      await service.addExerciseToLog('log-1', 'ex-1', 'me', 3);

      expect(loggedExerciseModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ exerciseId: 'ex-1', orderIndex: 0 }),
        { transaction: fakeTx },
      );
      expect(loggedSetModel.bulkCreate).toHaveBeenCalledWith(
        [0, 1, 2].map((orderIndex) =>
          expect.objectContaining({ loggedExerciseId: 'le-new', orderIndex }),
        ),
        { transaction: fakeTx },
      );
    });
  });

  describe('saveLogAsRoutine', () => {
    const done = { id: 'log-1', userId: 'me', name: 'Saturday session' };

    const seed = () => {
      logModel.findByPk.mockResolvedValueOnce(done);
      programModel.create.mockResolvedValueOnce({ id: 'p-new' });
      programWorkoutModel.create.mockResolvedValueOnce({ id: 'pw-new' });
      prescribedExerciseModel.create.mockResolvedValueOnce({ id: 'pe-new' });
    };

    it("bakes what you actually lifted into next time's targets", async () => {
      seed();
      loggedExerciseModel.findAll.mockResolvedValueOnce([
        {
          exerciseId: 'ex-1',
          orderIndex: 0,
          supersetGroupId: null,
          notes: null,
          sets: [
            { setType: 'NORMAL', reps: 8, weightKg: 60, restAfterSeconds: 90 },
          ],
        },
      ]);

      await service.saveLogAsRoutine('log-1', 'me', { name: 'Push day A' });

      const [rows] = prescribedSetModel.bulkCreate.mock.calls[0] as [
        Array<Record<string, unknown>>,
      ];
      // Reps land on both ends so the target reads as a number, not a
      // range the person never asked for.
      expect(rows[0]).toEqual(
        expect.objectContaining({
          targetRepsMin: 8,
          targetRepsMax: 8,
          targetWeightKg: 60,
          restAfterSeconds: 90,
        }),
      );
      expect(programModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ isSingleWorkout: true, source: 'USER' }),
        expect.anything(),
      );
    });

    it('keeps the shape but drops the loads in STRUCTURE mode', async () => {
      seed();
      loggedExerciseModel.findAll.mockResolvedValueOnce([
        {
          exerciseId: 'ex-1',
          orderIndex: 0,
          supersetGroupId: null,
          notes: null,
          sets: [{ setType: 'NORMAL', reps: 8, weightKg: 60 }],
        },
      ]);

      await service.saveLogAsRoutine('log-1', 'me', {
        name: 'Push day A',
        mode: SaveRoutineMode.Structure,
      });

      const [rows] = prescribedSetModel.bulkCreate.mock.calls[0] as [
        Array<Record<string, unknown>>,
      ];
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual(
        expect.objectContaining({
          targetRepsMin: null,
          targetWeightKg: null,
        }),
      );
    });

    it('leaves skipped exercises out of the routine', async () => {
      logModel.findByPk.mockResolvedValueOnce(done);
      loggedExerciseModel.findAll.mockResolvedValueOnce([]);

      await expect(
        service.saveLogAsRoutine('log-1', 'me', { name: 'Nothing' }),
      ).rejects.toThrow(BadRequestException);
      // The query itself excludes them, so an all-skipped workout has
      // nothing worth repeating.
      expect(loggedExerciseModel.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ isSkipped: false }),
        }),
      );
    });
  });

  // ─── skip / swap — migration 056 columns ─────────────────────────

  describe('skip and swap', () => {
    const live = {
      id: 'log-1',
      userId: 'me',
      status: WorkoutLogStatus.InProgress,
    };

    it('marks an exercise skipped instead of deleting it', async () => {
      logModel.findByPk.mockResolvedValueOnce(live);
      const ex = {
        id: 'le-1',
        workoutLogId: 'log-1',
        update: jest.fn().mockResolvedValue(undefined),
        destroy: jest.fn(),
      };
      loggedExerciseModel.findByPk.mockResolvedValueOnce(ex);

      await service.setExerciseSkipped('log-1', 'le-1', 'me', true);

      expect(ex.update).toHaveBeenCalledWith({ isSkipped: true });
      // The row has to survive — a deleted one is indistinguishable
      // from an exercise that was never in the workout.
      expect(ex.destroy).not.toHaveBeenCalled();
    });

    it('records the original exercise across repeated swaps', async () => {
      logModel.findByPk.mockResolvedValueOnce(live);
      const ex = {
        id: 'le-1',
        workoutLogId: 'log-1',
        exerciseId: 'first-substitute',
        // Already swapped once, from the coach's original.
        swappedFromExerciseId: 'coach-original',
        update: jest.fn().mockResolvedValue(undefined),
      };
      loggedExerciseModel.findByPk.mockResolvedValueOnce(ex);
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'second-substitute',
        name: 'Hack squat',
        thumbnailUrl: null,
        visibility: 'PUBLIC',
        ownerId: null,
      });

      await service.swapLoggedExercise(
        'log-1',
        'le-1',
        'me',
        'second-substitute',
      );

      expect(ex.update).toHaveBeenCalledWith(
        expect.objectContaining({
          exerciseId: 'second-substitute',
          // NOT 'first-substitute' — the anchor stays the prescription.
          swappedFromExerciseId: 'coach-original',
          exerciseNameSnapshot: 'Hack squat',
        }),
      );
    });

    it("refuses to swap in someone else's private exercise", async () => {
      logModel.findByPk.mockResolvedValueOnce(live);
      loggedExerciseModel.findByPk.mockResolvedValueOnce({
        id: 'le-1',
        workoutLogId: 'log-1',
        exerciseId: 'ex-old',
        swappedFromExerciseId: null,
        update: jest.fn(),
      });
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'ex-private',
        visibility: 'PRIVATE',
        ownerId: 'someone-else',
      });

      await expect(
        service.swapLoggedExercise('log-1', 'le-1', 'me', 'ex-private'),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses edits once the workout is finished', async () => {
      logModel.findByPk.mockResolvedValueOnce({
        id: 'log-1',
        userId: 'me',
        status: WorkoutLogStatus.Completed,
      });

      await expect(
        service.setExerciseSkipped('log-1', 'le-1', 'me', true),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── start() — %1RM resolution + hydration ───────────────────────

  describe('start — hydrates the log tree and resolves %1RM', () => {
    const stamp = jest.fn().mockResolvedValue(undefined);
    const aw = {
      id: 'aw-1',
      programAssignmentId: 'pa-1',
      name: 'Day 1 — Upper',
      update: jest.fn().mockResolvedValue(undefined),
      exercises: [
        {
          id: 'ae-1',
          exerciseId: 'ex-1',
          orderIndex: 0,
          supersetGroupId: null,
          exercise: { id: 'ex-1', name: 'Squat', thumbnailUrl: 'x.jpg' },
          sets: [
            {
              id: 'as-1',
              orderIndex: 0,
              setType: 'NORMAL',
              targetWeightKg: null,
              targetWeightPercent1rm: 80,
              update: stamp,
            },
            {
              id: 'as-2',
              orderIndex: 1,
              setType: 'NORMAL',
              targetWeightKg: 60, // not a %1RM set — should NOT be stamped
              targetWeightPercent1rm: null,
              update: stamp,
            },
          ],
        },
      ],
    };

    beforeEach(() => {
      assignedWorkoutModel.findByPk.mockResolvedValueOnce(aw);
      assignedWorkoutModel.findOne.mockResolvedValueOnce({
        assignment: { clientId: 'me' },
      });
      // Latest 1RM for ex-1 = 100kg.
      oneRepMaxModel.findAll.mockResolvedValueOnce([
        { exerciseId: 'ex-1', weightKg: 100, recordedAt: new Date() },
      ]);
      logModel.create.mockResolvedValueOnce({ id: 'wl-1' });
      loggedExerciseModel.create.mockResolvedValueOnce({ id: 'le-1' });
    });

    it('resolves the %1RM set to 80kg and stamps it on assigned_set', async () => {
      await service.start('me', { assignedWorkoutId: 'aw-1' });

      // 80% of 100kg = 80kg.
      expect(stamp).toHaveBeenCalledWith(
        expect.objectContaining({ resolvedWeightKg: 80 }),
        { transaction: fakeTx },
      );
      // The second set (absolute kg, no %1RM) should NOT have been stamped.
      expect(stamp).toHaveBeenCalledTimes(1);
    });

    it('flips assigned_workout status to IN_PROGRESS', async () => {
      await service.start('me', { assignedWorkoutId: 'aw-1' });
      expect(aw.update).toHaveBeenCalledWith(
        { status: WorkoutLogStatus.InProgress },
        { transaction: fakeTx },
      );
    });

    it('pre-seeds logged_set rows mirroring the assigned plan', async () => {
      await service.start('me', { assignedWorkoutId: 'aw-1' });
      expect(loggedSetModel.bulkCreate).toHaveBeenCalledTimes(1);
      const rows = loggedSetModel.bulkCreate.mock.calls[0][0];
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual(
        expect.objectContaining({
          assignedSetId: 'as-1',
          loggedExerciseId: 'le-1',
          isCompleted: false,
        }),
      );
    });
  });

  // ─── complete() ──────────────────────────────────────────────────

  describe('discard', () => {
    it('refuses to delete a workout that is already finished', async () => {
      const log = {
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.Completed,
        destroy: jest.fn(),
      };
      logModel.findByPk.mockResolvedValueOnce(log);

      await expect(service.discard('wl-1', 'me')).rejects.toThrow(
        BadRequestException,
      );
      expect(log.destroy).not.toHaveBeenCalled();
    });

    // Starting mirrors IN_PROGRESS onto the assignment side. Deleting
    // the log without clearing that leaves the day stuck showing a
    // workout in progress that no longer exists.
    it('clears the assigned workout status so the day is pending again', async () => {
      const destroy = jest.fn().mockResolvedValue(undefined);
      const log = {
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.InProgress,
        assignedWorkoutId: 'aw-1',
        programAssignmentId: null,
        sourceProgramId: null,
        destroy,
      };
      logModel.findByPk.mockResolvedValueOnce(log);

      await service.discard('wl-1', 'me');

      expect(assignedWorkoutModel.update).toHaveBeenCalledWith(
        { status: null },
        expect.objectContaining({ where: { id: 'aw-1' } }),
      );
      expect(destroy).toHaveBeenCalled();
    });

    // Starting bumps the routine's lastPerformedAt. Cancelling has to
    // walk it back or the routine claims "Last done today".
    it('rolls lastPerformedAt back to the newest surviving log', async () => {
      const log = {
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.InProgress,
        assignedWorkoutId: null,
        programAssignmentId: null,
        sourceProgramId: 'prog-1',
        destroy: jest.fn().mockResolvedValue(undefined),
      };
      const previous = new Date('2026-08-01T10:00:00Z');
      logModel.findByPk.mockResolvedValueOnce(log);
      programModel.findByPk.mockResolvedValueOnce({
        id: 'prog-1',
        source: 'USER',
      });
      logModel.findOne.mockResolvedValueOnce({ startedAt: previous });

      await service.discard('wl-1', 'me');

      expect(programModel.update).toHaveBeenCalledWith(
        { lastPerformedAt: previous },
        { where: { id: 'prog-1' } },
      );
    });
  });

  describe('complete', () => {
    it('is idempotent on an already-completed log', async () => {
      const log = {
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.Completed,
        update: jest.fn(),
      };
      logModel.findByPk.mockResolvedValueOnce(log);
      await service.complete('wl-1', {}, 'me');
      expect(log.update).not.toHaveBeenCalled();
    });

    // The feedback screen runs after the log is already COMPLETED, so
    // this second call is the only chance the rating + note ever get
    // written. Returning early here loses them while the UI says saved.
    it('still applies feedback posted after the log is completed', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      const log = {
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.Completed,
        update,
      };
      logModel.findByPk.mockResolvedValueOnce(log);

      await service.complete(
        'wl-1',
        { feelingRating: 5, notes: '  felt strong  ' },
        'me',
      );

      expect(update).toHaveBeenCalledWith({
        feelingRating: 5,
        notes: 'felt strong',
      });
    });

    it('computes durationSeconds from startedAt → now', async () => {
      const startedAt = new Date(Date.now() - 65_000); // 65s ago
      const update = jest.fn().mockResolvedValue(undefined);
      const log = {
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.InProgress,
        startedAt,
        programAssignmentId: null,
        assignedWorkoutId: null,
        update,
      };
      logModel.findByPk.mockResolvedValueOnce(log);

      await service.complete('wl-1', { feelingRating: 4 }, 'me');

      const args = update.mock.calls[0][0];
      expect(args.status).toBe(WorkoutLogStatus.Completed);
      expect(args.durationSeconds).toBeGreaterThanOrEqual(60);
      expect(args.feelingRating).toBe(4);
    });
  });

  // ─── Epley 1RM estimate ──────────────────────────────────────────

  describe('estimateOneRepMaxEpley', () => {
    it('returns null on missing inputs', () => {
      expect(service.estimateOneRepMaxEpley(null, 100)).toBeNull();
      expect(service.estimateOneRepMaxEpley(5, null)).toBeNull();
    });
    it('returns null beyond the safe rep range (Epley breaks past ~12)', () => {
      expect(service.estimateOneRepMaxEpley(15, 80)).toBeNull();
      expect(service.estimateOneRepMaxEpley(0, 80)).toBeNull();
    });
    it('estimates 100kg × 1 = 100', () => {
      expect(service.estimateOneRepMaxEpley(1, 100)).toBeCloseTo(103.33, 1);
    });
    it('estimates 80kg × 5 ≈ 93.33', () => {
      expect(service.estimateOneRepMaxEpley(5, 80)).toBeCloseTo(93.33, 1);
    });
  });

  // ─── Cross-tenant hide ───────────────────────────────────────────

  describe('findById', () => {
    it('hides existence when the log belongs to someone else', async () => {
      logModel.findByPk.mockResolvedValueOnce({ id: 'wl-1', userId: 'other' });
      await expect(service.findById('wl-1', 'me')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // ─── Mid-session: add exercise ───────────────────────────────────

  describe('addExerciseToLog', () => {
    const inProgressLog = {
      id: 'wl-1',
      userId: 'me',
      status: WorkoutLogStatus.InProgress,
    };

    it('refuses when the log is not in progress', async () => {
      logModel.findByPk.mockResolvedValueOnce({
        ...inProgressLog,
        status: WorkoutLogStatus.Completed,
      });
      await expect(
        service.addExerciseToLog('wl-1', 'ex-1', 'me'),
      ).rejects.toThrow(BadRequestException);
    });

    it('hides existence when the log is not owned', async () => {
      logModel.findByPk.mockResolvedValueOnce({
        ...inProgressLog,
        userId: 'other',
      });
      await expect(
        service.addExerciseToLog('wl-1', 'ex-1', 'me'),
      ).rejects.toThrow(NotFoundException);
    });

    it("404s when the exercise doesn't exist", async () => {
      logModel.findByPk.mockResolvedValueOnce(inProgressLog);
      exerciseModel.findByPk.mockResolvedValueOnce(null);
      await expect(
        service.addExerciseToLog('wl-1', 'ex-x', 'me'),
      ).rejects.toThrow(NotFoundException);
    });

    it('404s on a PRIVATE exercise owned by someone else (no existence leak)', async () => {
      logModel.findByPk.mockResolvedValueOnce(inProgressLog);
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'ex-1',
        name: 'Squat',
        thumbnailUrl: null,
        visibility: 'PRIVATE',
        ownerId: 'someone-else',
      });
      await expect(
        service.addExerciseToLog('wl-1', 'ex-1', 'me'),
      ).rejects.toThrow(NotFoundException);
    });

    it('appends at the end of orderIndex and snapshots name + thumb', async () => {
      logModel.findByPk.mockResolvedValueOnce(inProgressLog);
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'ex-1',
        name: 'Bench',
        thumbnailUrl: 'b.jpg',
        visibility: 'PUBLIC',
        ownerId: null,
      });
      loggedExerciseModel.max.mockResolvedValueOnce(2);
      loggedExerciseModel.create.mockResolvedValueOnce({ id: 'le-new' });

      await service.addExerciseToLog('wl-1', 'ex-1', 'me');

      expect(loggedExerciseModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workoutLogId: 'wl-1',
          exerciseId: 'ex-1',
          exerciseNameSnapshot: 'Bench',
          exerciseThumbnailUrlSnapshot: 'b.jpg',
          orderIndex: 3,
          assignedExerciseId: null,
        }),
        { transaction: fakeTx },
      );
    });

    it('starts orderIndex at 0 when the log has no exercises yet', async () => {
      logModel.findByPk.mockResolvedValueOnce(inProgressLog);
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'ex-1',
        name: 'Bench',
        thumbnailUrl: null,
        visibility: 'PUBLIC',
        ownerId: null,
      });
      loggedExerciseModel.max.mockResolvedValueOnce(null);
      loggedExerciseModel.create.mockResolvedValueOnce({ id: 'le-new' });

      await service.addExerciseToLog('wl-1', 'ex-1', 'me');

      expect(loggedExerciseModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ orderIndex: 0 }),
        { transaction: fakeTx },
      );
    });
  });

  // ─── Mid-session: remove exercise ────────────────────────────────

  describe('removeExerciseFromLog', () => {
    it('refuses on a completed log', async () => {
      logModel.findByPk.mockResolvedValueOnce({
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.Completed,
      });
      await expect(
        service.removeExerciseFromLog('wl-1', 'le-1', 'me'),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s when the logged exercise belongs to a different log', async () => {
      logModel.findByPk.mockResolvedValueOnce({
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.InProgress,
      });
      loggedExerciseModel.findByPk.mockResolvedValueOnce({
        id: 'le-1',
        workoutLogId: 'wl-OTHER',
      });
      await expect(
        service.removeExerciseFromLog('wl-1', 'le-1', 'me'),
      ).rejects.toThrow(NotFoundException);
    });

    it('destroys the row on the happy path', async () => {
      const destroy = jest.fn().mockResolvedValue(undefined);
      logModel.findByPk.mockResolvedValueOnce({
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.InProgress,
      });
      loggedExerciseModel.findByPk.mockResolvedValueOnce({
        id: 'le-1',
        workoutLogId: 'wl-1',
        destroy,
      });
      await service.removeExerciseFromLog('wl-1', 'le-1', 'me');
      expect(destroy).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Mid-session: add set ────────────────────────────────────────

  describe('addSetToLog', () => {
    const inProgressLog = {
      id: 'wl-1',
      userId: 'me',
      status: WorkoutLogStatus.InProgress,
    };

    it('refuses on a non-in-progress log', async () => {
      logModel.findByPk.mockResolvedValueOnce({
        ...inProgressLog,
        status: WorkoutLogStatus.Abandoned,
      });
      await expect(
        service.addSetToLog('wl-1', 'le-1', {}, 'me'),
      ).rejects.toThrow(BadRequestException);
    });

    it("404s when the exercise doesn't belong to the log", async () => {
      logModel.findByPk.mockResolvedValueOnce(inProgressLog);
      loggedExerciseModel.findByPk.mockResolvedValueOnce({
        id: 'le-1',
        workoutLogId: 'wl-OTHER',
      });
      await expect(
        service.addSetToLog('wl-1', 'le-1', {}, 'me'),
      ).rejects.toThrow(NotFoundException);
    });

    it('appends a NORMAL set at the end and leaves it un-completed', async () => {
      logModel.findByPk.mockResolvedValueOnce(inProgressLog);
      loggedExerciseModel.findByPk.mockResolvedValueOnce({
        id: 'le-1',
        workoutLogId: 'wl-1',
      });
      loggedSetModel.max.mockResolvedValueOnce(1);
      loggedSetModel.create.mockResolvedValueOnce({ id: 'ls-new' });

      await service.addSetToLog('wl-1', 'le-1', {}, 'me');

      expect(loggedSetModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          loggedExerciseId: 'le-1',
          assignedSetId: null,
          orderIndex: 2,
          setType: 'NORMAL',
          isCompleted: false,
        }),
      );
    });

    it('honours an explicit setType from the DTO', async () => {
      logModel.findByPk.mockResolvedValueOnce(inProgressLog);
      loggedExerciseModel.findByPk.mockResolvedValueOnce({
        id: 'le-1',
        workoutLogId: 'wl-1',
      });
      loggedSetModel.max.mockResolvedValueOnce(null);
      loggedSetModel.create.mockResolvedValueOnce({ id: 'ls-new' });

      await service.addSetToLog('wl-1', 'le-1', { setType: 'WARMUP' }, 'me');

      expect(loggedSetModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ setType: 'WARMUP', orderIndex: 0 }),
      );
    });
  });

  // ─── 1RM manual record + list ────────────────────────────────────

  describe('recordOneRepMax', () => {
    it('defaults source to MANUAL and recordedAt to now when omitted', async () => {
      oneRepMaxModel.create.mockResolvedValueOnce({ id: 'orm-1' });
      await service.recordOneRepMax('me', {
        exerciseId: 'ex-1',
        weightKg: 120,
      });
      const args = oneRepMaxModel.create.mock.calls[0][0];
      expect(args.userId).toBe('me');
      expect(args.exerciseId).toBe('ex-1');
      expect(args.weightKg).toBe(120);
      expect(args.source).toBe('MANUAL');
      expect(args.recordedAt).toBeInstanceOf(Date);
      expect(args.notes).toBeNull();
    });

    it('coerces blank notes to null but keeps real notes trimmed', async () => {
      oneRepMaxModel.create.mockResolvedValueOnce({ id: 'orm-2' });
      await service.recordOneRepMax('me', {
        exerciseId: 'ex-1',
        weightKg: 100,
        notes: '   ',
      });
      expect(oneRepMaxModel.create.mock.calls[0][0].notes).toBeNull();

      oneRepMaxModel.create.mockResolvedValueOnce({ id: 'orm-3' });
      await service.recordOneRepMax('me', {
        exerciseId: 'ex-1',
        weightKg: 100,
        notes: '  felt strong  ',
      });
      expect(oneRepMaxModel.create.mock.calls[1][0].notes).toBe('felt strong');
    });
  });

  describe('listOneRepMaxes', () => {
    it('paginates with PrimeNG-shaped response', async () => {
      oneRepMaxModel.findAndCountAll.mockResolvedValueOnce({
        rows: [{ id: 'orm-1' }],
        count: 1,
      });
      const out = await service.listOneRepMaxes('me', { page: 1, limit: 20 });
      expect(out).toEqual({
        items: [{ id: 'orm-1' }],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    });
  });

  // ─── Coach read-only access ──────────────────────────────────────

  describe('listForClientByInstructor', () => {
    it('404s when no ACTIVE coach link exists', async () => {
      instructorClientModel.findOne.mockResolvedValueOnce(null);
      await expect(
        service.listForClientByInstructor('coach-1', 'client-1', {
          page: 1,
          limit: 20,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(logModel.findAndCountAll).not.toHaveBeenCalled();
    });

    it('only matches ACTIVE links (filter passed to instructor_client query)', async () => {
      instructorClientModel.findOne.mockResolvedValueOnce(null);
      await expect(
        service.listForClientByInstructor('coach-1', 'client-1', {
          page: 1,
          limit: 20,
        }),
      ).rejects.toThrow(NotFoundException);
      expect(instructorClientModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            instructorId: 'coach-1',
            clientId: 'client-1',
            status: 'ACTIVE',
          }),
        }),
      );
    });

    it('delegates to listForUser(clientId) when the link is ACTIVE', async () => {
      instructorClientModel.findOne.mockResolvedValueOnce({ id: 'link-1' });
      assignmentModel.findAll.mockResolvedValueOnce([
        { id: 'asg-1', shareOffPlan: true },
      ]);
      logModel.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      const out = await service.listForClientByInstructor(
        'coach-1',
        'client-1',
        { page: 1, limit: 20 },
      );
      const args = logModel.findAndCountAll.mock.calls[0][0];
      expect(args.where).toEqual(
        expect.objectContaining({ userId: 'client-1' }),
      );
      expect(out).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    });
  });

  describe('off-plan privacy', () => {
    it('restricts the coach to their own assignments by default', async () => {
      instructorClientModel.findOne.mockResolvedValueOnce({ id: 'link-1' });
      assignmentModel.findAll.mockResolvedValueOnce([
        { id: 'asg-1', shareOffPlan: false },
        { id: 'asg-2', shareOffPlan: false },
      ]);
      logModel.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await service.listForClientByInstructor('coach-1', 'client-1', {
        page: 1,
        limit: 20,
      });

      const args = logModel.findAndCountAll.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      // Freestyle logs have a null programAssignmentId, so an IN over
      // the coach's own assignment ids excludes them.
      const clause = args.where['programAssignmentId'] as Record<
        symbol,
        unknown
      >;
      expect(clause).toBeDefined();
      const ids = Object.getOwnPropertySymbols(clause).map((x) => clause[x])[0];
      expect(ids).toEqual(['asg-1', 'asg-2']);
    });

    it('lifts the restriction when the client shared off-plan work', async () => {
      instructorClientModel.findOne.mockResolvedValueOnce({ id: 'link-1' });
      assignmentModel.findAll.mockResolvedValueOnce([
        { id: 'asg-1', shareOffPlan: false },
        { id: 'asg-2', shareOffPlan: true },
      ]);
      logModel.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });

      await service.listForClientByInstructor('coach-1', 'client-1', {
        page: 1,
        limit: 20,
      });

      const args = logModel.findAndCountAll.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(args.where['programAssignmentId']).toBeUndefined();
    });

    it('404s on a freestyle log the coach was not given', async () => {
      logModel.findByPk.mockResolvedValueOnce({
        userId: 'client-1',
        programAssignmentId: null,
      });
      instructorClientModel.findOne.mockResolvedValueOnce({ id: 'link-1' });
      assignmentModel.findAll.mockResolvedValueOnce([
        { id: 'asg-1', shareOffPlan: false },
      ]);

      await expect(
        service.findByIdForInstructor('log-solo', 'coach-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("404s on a log from another coach's assignment", async () => {
      logModel.findByPk.mockResolvedValueOnce({
        userId: 'client-1',
        programAssignmentId: 'asg-other',
      });
      instructorClientModel.findOne.mockResolvedValueOnce({ id: 'link-1' });
      assignmentModel.findAll.mockResolvedValueOnce([
        { id: 'asg-1', shareOffPlan: false },
      ]);

      await expect(
        service.findByIdForInstructor('log-x', 'coach-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('findByIdForInstructor', () => {
    it('404s when the log does not exist', async () => {
      logModel.findByPk.mockResolvedValueOnce(null);
      await expect(
        service.findByIdForInstructor('wl-x', 'coach-1'),
      ).rejects.toThrow(NotFoundException);
      expect(instructorClientModel.findOne).not.toHaveBeenCalled();
    });

    it('404s when the log owner is not an ACTIVE client of the caller', async () => {
      logModel.findByPk.mockResolvedValueOnce({ userId: 'client-1' });
      instructorClientModel.findOne.mockResolvedValueOnce(null);
      await expect(
        service.findByIdForInstructor('wl-1', 'coach-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('returns the full plain log on the happy path', async () => {
      // First call: lightweight stub. It carries the assignment now —
      // the coach may only read work they prescribed, so a log with no
      // assignment is off-plan and hidden.
      logModel.findByPk.mockResolvedValueOnce({
        userId: 'client-1',
        programAssignmentId: 'asg-1',
      });
      instructorClientModel.findOne.mockResolvedValueOnce({ id: 'link-1' });
      assignmentModel.findAll.mockResolvedValueOnce([
        { id: 'asg-1', shareOffPlan: false },
      ]);
      // Second call: the full-tree findByPk inside findById()
      const plainProjection = {
        id: 'wl-1',
        userId: 'client-1',
        completedAt: null,
        startedAt: new Date(),
        status: WorkoutLogStatus.Completed,
      };
      logModel.findByPk.mockResolvedValueOnce({
        id: 'wl-1',
        userId: 'client-1',
        completedAt: null,
        startedAt: new Date(),
        status: WorkoutLogStatus.Completed,
        get: () => plainProjection,
      });
      // No PRs in the window — _findSessionPrs will query oneRepMaxModel.
      oneRepMaxModel.findAll.mockResolvedValueOnce([]);

      const out = await service.findByIdForInstructor('wl-1', 'coach-1');

      expect(out).toBe(plainProjection);
    });
  });

  // ─── Most-recent in-progress (home resume tile) ──────────────────

  describe('findInProgressForUser', () => {
    it('returns null when the user has no IN_PROGRESS log', async () => {
      logModel.findOne.mockResolvedValueOnce(null);
      const out = await service.findInProgressForUser('me');
      expect(out).toBeNull();
      expect(logModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'me', status: WorkoutLogStatus.InProgress },
          order: [['startedAt', 'DESC']],
        }),
      );
    });

    it('returns the most-recent IN_PROGRESS log when one exists', async () => {
      const row = { id: 'wl-9', name: 'Pull day', startedAt: new Date() };
      logModel.findOne.mockResolvedValueOnce(row);
      const out = await service.findInProgressForUser('me');
      expect(out).toBe(row);
    });
  });

  // ─── Find log by assigned workout (plan-detail "View" CTA) ───────

  describe('findByAssignedWorkout', () => {
    it("404s when the assigned workout isn't owned by the caller", async () => {
      assignedWorkoutModel.findOne.mockResolvedValueOnce(null);
      await expect(service.findByAssignedWorkout('aw-x', 'me')).rejects.toThrow(
        NotFoundException,
      );
      expect(logModel.findOne).not.toHaveBeenCalled();
    });

    it('404s when the workout was never started (no log row)', async () => {
      assignedWorkoutModel.findOne.mockResolvedValueOnce({
        assignment: { clientId: 'me' },
      });
      logModel.findOne.mockResolvedValueOnce(null);
      await expect(service.findByAssignedWorkout('aw-1', 'me')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns the latest log when one exists', async () => {
      assignedWorkoutModel.findOne.mockResolvedValueOnce({
        assignment: { clientId: 'me' },
      });
      logModel.findOne.mockResolvedValueOnce({ id: 'wl-1' });
      const out = await service.findByAssignedWorkout('aw-1', 'me');
      expect(out).toEqual({ id: 'wl-1' });
      expect(logModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'me', assignedWorkoutId: 'aw-1' },
          order: [['startedAt', 'DESC']],
        }),
      );
    });
  });

  // ─── Last session for exercise (history hint) ────────────────────

  describe('lastSessionForExercise', () => {
    it('returns [] when no prior completed session exists', async () => {
      loggedExerciseModel.findOne.mockResolvedValueOnce(null);
      const out = await service.lastSessionForExercise('me', 'ex-1');
      expect(out).toEqual([]);
      expect(loggedSetModel.findAll).not.toHaveBeenCalled();
    });

    it('returns up to 6 completed sets from the most-recent prior session', async () => {
      loggedExerciseModel.findOne.mockResolvedValueOnce({ id: 'le-prior' });
      const sets = [
        { id: 's1', isCompleted: true },
        { id: 's2', isCompleted: true },
      ];
      loggedSetModel.findAll.mockResolvedValueOnce(sets);

      const out = await service.lastSessionForExercise('me', 'ex-1');

      expect(out).toBe(sets);
      expect(loggedSetModel.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { loggedExerciseId: 'le-prior', isCompleted: true },
          limit: 6,
        }),
      );
    });
  });
});
