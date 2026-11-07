import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Op } from 'sequelize';
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
import { InstructorProfile } from '../profile/entities/instructor-profile.entity';
import { NotificationService } from '../notification/notification.service';
import { ExerciseNoteService } from '../exercise/exercise-note.service';
import { MediaStorageService } from '../../common/services/media-storage.service';
import { Program } from './entities/program.entity';
import { WorkoutLog } from './entities/workout-log.entity';
import {
  ProgramSource,
  RestSource,
  WorkoutLogStatus,
} from './entities/workout.enums';
import { SaveRoutineMode } from './dto/save-log-as-routine.dto';
import { WorkoutLogService } from './workout-log.service';
import { CoachAccessService } from './coach-access.service';
import { ProgramAssignmentService } from './program-assignment.service';
import {
  fakeTx,
  makeSilentLogger,
} from '../../../test/helpers/sequelize-mocks';
import { foldedLike } from '../../../test/helpers/folded-search';

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
    findAll: jest.fn(),
    create: jest.fn(),
    count: jest.fn(),
  };
  const loggedExerciseModel = {
    create: jest.fn(),
    findAll: jest.fn().mockResolvedValue([]),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    max: jest.fn(),
    update: jest.fn(),
  };
  const loggedSetModel = {
    findByPk: jest.fn(),
    findOne: jest.fn(),
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
    findOne: jest.fn(),
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
  const programWorkoutModel = { create: jest.fn(), findAll: jest.fn() };
  const instructorClientModel = { findOne: jest.fn() };
  const assignmentModel = {
    findByPk: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
  };
  const userModel = { findByPk: jest.fn() };
  const instructorProfileModel = { findOne: jest.fn() };
  const notificationService = { notify: jest.fn().mockResolvedValue({}) };
  const assignments = {
    completeIfFinished: jest.fn().mockResolvedValue(false),
  };
  const exerciseNotes = { notesFor: jest.fn().mockResolvedValue(new Map()) };
  const storage = { deletePrivateImage: jest.fn() };
  const sequelize = {
    transaction: jest.fn((cb: (tx: unknown) => unknown) =>
      Promise.resolve(cb(fakeTx)),
    ),
    query: jest.fn(),
    literal: jest.fn((sql: string) => ({ sql })),
    // History's folded name search quotes its term with it.
    escape: (value: string) => `'${value.replace(/'/g, "''")}'`,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        WorkoutLogService,
        // Real rule, mocked models: the coach-access tests below exercise
        // it through instructorClientModel + assignmentModel.
        CoachAccessService,
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
        {
          provide: getModelToken(InstructorProfile),
          useValue: instructorProfileModel,
        },
        { provide: NotificationService, useValue: notificationService },
        { provide: ProgramAssignmentService, useValue: assignments },
        { provide: ExerciseNoteService, useValue: exerciseNotes },
        { provide: MediaStorageService, useValue: storage },
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

    it('refuses to start while another workout is in progress', async () => {
      logModel.findOne.mockResolvedValueOnce({
        id: 'wl-open',
        name: 'Push day',
      });

      await expect(service.start('me', { name: 'Freestyle' })).rejects.toThrow(
        ConflictException,
      );
      expect(logModel.create).not.toHaveBeenCalled();
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

    // A routine copied from a starter is a DRAFT, and archiving one is
    // only a status: neither stops it from being started.
    it.each(['DRAFT', 'ARCHIVED'])(
      'starts a %s routine like any other',
      async (status) => {
        programModel.findByPk.mockResolvedValueOnce(makeProgram({ status }));
        prescribedExerciseModel.findAll.mockResolvedValueOnce([]);
        logModel.create.mockResolvedValueOnce({ id: 'log-3' });

        await expect(
          service.start('me', { programId: 'p-1' }),
        ).resolves.toEqual({ id: 'log-3' });
      },
    );

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

  describe('remove — discarding a workout in progress', () => {
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

      await service.remove('wl-1', 'me');

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

      await service.remove('wl-1', 'me');

      expect(programModel.update).toHaveBeenCalledWith(
        { lastPerformedAt: previous },
        { where: { id: 'prog-1' } },
      );
    });
  });

  describe('complete', () => {
    // The finish screen uploads its photo before the feedback call, so the
    // second complete must answer with the flag, never the Cloudinary id.
    it('answers with the photo as a flag, never its id', async () => {
      const log = {
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.Completed,
        photoPublicId: 'workout-photos/me/wl-1',
        update: jest.fn().mockResolvedValue(undefined),
        get() {
          return this;
        },
      };
      logModel.findByPk.mockResolvedValueOnce(log);

      const out = await service.complete('wl-1', { feelingRating: 4 }, 'me');

      expect(out).toEqual(
        expect.objectContaining({ id: 'wl-1', hasPhoto: true }),
      );
      expect(JSON.stringify(out)).not.toContain('workout-photos');
    });

    it('is idempotent on an already-completed log', async () => {
      const log = {
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.Completed,
        update: jest.fn(),
        get() {
          return this;
        },
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
        get() {
          return this;
        },
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

    it.each([WorkoutLogStatus.Skipped, WorkoutLogStatus.Abandoned])(
      'refuses to complete a %s log',
      async (status) => {
        const update = jest.fn();
        logModel.findByPk.mockResolvedValueOnce({
          id: 'wl-1',
          userId: 'me',
          status,
          startedAt: new Date(Date.now() - 65_000),
          update,
          get() {
            return this;
          },
        });

        await expect(
          service.complete('wl-1', { feelingRating: 4 }, 'me'),
        ).rejects.toMatchObject({
          response: { messageKey: 'workout.cannotCompleteNotInProgress' },
        });
        expect(update).not.toHaveBeenCalled();
      },
    );

    // The message goes on a card other people see: one plain line.
    it('keeps the share message as one line of plain text', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      logModel.findByPk.mockResolvedValueOnce({
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.Completed,
        update,
        get() {
          return this;
        },
      });

      await service.complete(
        'wl-1',
        { shareCaption: '  First <b>100</b>!\n The knee held.  ' },
        'me',
      );

      expect(update).toHaveBeenCalledWith({
        shareCaption: 'First 100! The knee held.',
      });
    });

    it('clears the share message when it is sent empty', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      logModel.findByPk.mockResolvedValueOnce({
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.Completed,
        update,
        get() {
          return this;
        },
      });

      await service.complete('wl-1', { shareCaption: '   ' }, 'me');

      expect(update).toHaveBeenCalledWith({ shareCaption: null });
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
        get() {
          return this;
        },
      };
      logModel.findByPk.mockResolvedValueOnce(log);

      await service.complete('wl-1', { feelingRating: 4 }, 'me');

      const args = update.mock.calls[0][0];
      expect(args.status).toBe(WorkoutLogStatus.Completed);
      expect(args.durationSeconds).toBeGreaterThanOrEqual(60);
      expect(args.feelingRating).toBe(4);
    });

    // Time spent paused was not training: past pauses and one still open
    // at Finish both come off the duration.
    it('leaves paused time out of durationSeconds', async () => {
      const now = Date.now();
      const update = jest.fn().mockResolvedValue(undefined);
      const log = {
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.InProgress,
        startedAt: new Date(now - 3_600_000), // an hour ago
        pausedSeconds: 1_200, // 20 min paused earlier
        pausedAt: new Date(now - 600_000), // and paused for the last 10
        programAssignmentId: null,
        assignedWorkoutId: null,
        update,
        get() {
          return this;
        },
      };
      logModel.findByPk.mockResolvedValueOnce(log);

      await service.complete('wl-1', {}, 'me');

      const args = update.mock.calls[0][0];
      expect(args.durationSeconds).toBeGreaterThanOrEqual(1_799);
      expect(args.durationSeconds).toBeLessThanOrEqual(1_801);
      expect(args.pausedAt).toBeNull();
      expect(args.pausedSeconds).toBeGreaterThanOrEqual(1_799);
    });

    const runningLog = (fields: Record<string, unknown> = {}) => ({
      id: 'wl-1',
      userId: 'me',
      status: WorkoutLogStatus.InProgress,
      pausedSeconds: 0,
      pausedAt: null,
      programAssignmentId: null,
      assignedWorkoutId: null,
      update: jest.fn().mockResolvedValue(undefined),
      get() {
        return this;
      },
      ...fields,
    });

    // Forgetting to tap Finish must not turn a 50 minute session into a
    // 30 hour one, nor move it to the day Finish was finally tapped.
    it('ends a workout left open at its last ticked set', async () => {
      const now = Date.now();
      const startedAt = new Date(now - 30 * 3_600_000);
      const lastSetAt = new Date(startedAt.getTime() + 50 * 60_000);
      const log = runningLog({ startedAt });
      logModel.findByPk.mockResolvedValueOnce(log);
      loggedSetModel.findOne.mockResolvedValueOnce({ completedAt: lastSetAt });

      await service.complete('wl-1', {}, 'me');

      const args = log.update.mock.calls[0][0];
      expect(args.completedAt).toEqual(lastSetAt);
      expect(args.durationSeconds).toBe(50 * 60);
    });

    // Paused after the last set, resumed, then left: that pause sits in the
    // time already cut off, so taking it off again would shorten the
    // training, here down to nothing.
    it('does not take a pause after the last set off the training', async () => {
      const now = Date.now();
      const startedAt = new Date(now - 2 * 3_600_000);
      const lastSetAt = new Date(startedAt.getTime() + 40 * 60_000);
      const log = runningLog({ startedAt, pausedSeconds: 45 * 60 });
      logModel.findByPk.mockResolvedValueOnce(log);
      loggedSetModel.findOne.mockResolvedValueOnce({ completedAt: lastSetAt });

      await service.complete('wl-1', {}, 'me');

      const args = log.update.mock.calls[0][0];
      expect(args.completedAt).toEqual(lastSetAt);
      expect(args.durationSeconds).toBe(40 * 60);
      expect(args.pausedSeconds).toBe(0);
    });

    it('ends at Finish when the last set was minutes ago', async () => {
      const now = Date.now();
      const log = runningLog({ startedAt: new Date(now - 3_600_000) });
      logModel.findByPk.mockResolvedValueOnce(log);
      loggedSetModel.findOne.mockResolvedValueOnce({
        completedAt: new Date(now - 10 * 60_000),
      });

      await service.complete('wl-1', {}, 'me');

      const args = log.update.mock.calls[0][0];
      expect(args.completedAt.getTime()).toBeGreaterThanOrEqual(now);
      expect(args.durationSeconds).toBeGreaterThanOrEqual(3_599);
    });

    it('stores no duration past six hours of active time', async () => {
      const now = Date.now();
      const log = runningLog({ startedAt: new Date(now - 7 * 3_600_000) });
      logModel.findByPk.mockResolvedValueOnce(log);
      // Sets ticked all along, so the end stays at Finish.
      loggedSetModel.findOne.mockResolvedValueOnce({
        completedAt: new Date(now - 60_000),
      });

      await service.complete('wl-1', {}, 'me');

      expect(log.update.mock.calls[0][0].durationSeconds).toBeNull();
    });

    it('finishes the plan straight away when this was its last workout', async () => {
      const log = runningLog({
        startedAt: new Date(Date.now() - 3_600_000),
        programAssignmentId: 'pa-1',
        assignedWorkoutId: 'aw-1',
      });
      logModel.findByPk.mockResolvedValueOnce(log);
      assignedWorkoutModel.count.mockResolvedValue(1);
      sequelize.query.mockResolvedValue(undefined);
      assignmentModel.findByPk.mockResolvedValueOnce(null);

      await service.complete('wl-1', {}, 'me');

      expect(assignments.completeIfFinished).toHaveBeenCalledWith('pa-1');
    });
  });

  describe('closeStaleWorkouts', () => {
    const now = new Date('2026-10-28T02:15:00Z');
    const stale = (fields: Record<string, unknown> = {}) => ({
      id: 'wl-1',
      userId: 'me',
      status: WorkoutLogStatus.InProgress,
      startedAt: new Date('2026-10-20T18:00:00Z'),
      pausedSeconds: 0,
      pausedAt: null,
      programAssignmentId: null,
      assignedWorkoutId: null,
      sourceProgramId: null,
      update: jest.fn().mockResolvedValue(undefined),
      destroy: jest.fn().mockResolvedValue(undefined),
      ...fields,
    });

    it('completes one with ticked sets, ending at the last set, and tells no coach', async () => {
      const log = stale({ programAssignmentId: 'pa-1' });
      const lastSetAt = new Date('2026-10-20T18:55:00Z');
      logModel.findAll.mockResolvedValueOnce([log]);
      loggedSetModel.findOne
        .mockResolvedValueOnce({ updatedAt: lastSetAt })
        .mockResolvedValueOnce({ completedAt: lastSetAt });
      logModel.findByPk.mockResolvedValueOnce(log);
      sequelize.query.mockResolvedValue(undefined);
      assignedWorkoutModel.count.mockResolvedValue(1);

      await expect(service.closeStaleWorkouts(now)).resolves.toEqual({
        completed: 1,
        discarded: 0,
      });

      const args = log.update.mock.calls[0][0];
      expect(args.status).toBe(WorkoutLogStatus.Completed);
      expect(args.completedAt).toEqual(lastSetAt);
      expect(args.durationSeconds).toBe(55 * 60);
      expect(assignments.completeIfFinished).toHaveBeenCalledWith('pa-1');
      // No coach is told; only the owner hears it was saved for them.
      expect(notificationService.notify).toHaveBeenCalledTimes(1);
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'me',
          type: 'WORKOUT_AUTO_SAVED',
          message: expect.objectContaining({ key: 'workout.workoutAutoSaved' }),
        }),
      );
    });

    it('discards one with nothing ticked', async () => {
      const log = stale();
      logModel.findAll.mockResolvedValueOnce([log]);
      loggedSetModel.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      logModel.findByPk.mockResolvedValueOnce(log);

      await expect(service.closeStaleWorkouts(now)).resolves.toEqual({
        completed: 0,
        discarded: 1,
      });
      expect(log.destroy).toHaveBeenCalled();
    });

    it('does not discard one the person finished while the sweep ran', async () => {
      const log = stale();
      logModel.findAll.mockResolvedValueOnce([log]);
      loggedSetModel.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      logModel.findByPk.mockResolvedValueOnce({
        ...log,
        status: WorkoutLogStatus.Completed,
      });

      await expect(service.closeStaleWorkouts(now)).resolves.toEqual({
        completed: 0,
        discarded: 0,
      });
      expect(log.destroy).not.toHaveBeenCalled();
    });

    it('leaves one whose sets were edited within the day', async () => {
      const log = stale();
      logModel.findAll.mockResolvedValueOnce([log]);
      loggedSetModel.findOne.mockResolvedValueOnce({
        updatedAt: new Date('2026-10-27T21:00:00Z'),
      });

      await expect(service.closeStaleWorkouts(now)).resolves.toEqual({
        completed: 0,
        discarded: 0,
      });
      expect(log.update).not.toHaveBeenCalled();
      expect(log.destroy).not.toHaveBeenCalled();
    });

    it('leaves one the person finished while the sweep ran', async () => {
      const log = stale();
      logModel.findAll.mockResolvedValueOnce([log]);
      loggedSetModel.findOne
        .mockResolvedValueOnce({ updatedAt: new Date('2026-10-20T18:55:00Z') })
        .mockResolvedValueOnce({
          completedAt: new Date('2026-10-20T18:55:00Z'),
        });
      logModel.findByPk.mockResolvedValueOnce({
        ...log,
        status: WorkoutLogStatus.Completed,
      });

      await expect(service.closeStaleWorkouts(now)).resolves.toEqual({
        completed: 0,
        discarded: 0,
      });
      expect(log.update).not.toHaveBeenCalled();
    });
  });

  describe('listForUser', () => {
    // The history list is the owner's and a coach's; neither ever gets the
    // stored asset's id, only whether there is a photo.
    it('returns the photo as a flag, never its Cloudinary id', async () => {
      logModel.findAndCountAll.mockResolvedValueOnce({
        rows: [
          {
            id: 'wl-1',
            status: WorkoutLogStatus.Completed,
            completedAt: null,
            get: () => ({
              id: 'wl-1',
              photoPublicId: 'workout-photos/me/wl-1',
              photoVersion: 2,
            }),
          },
        ],
        count: 1,
      });

      const page = await service.listForUser('me', { page: 1, limit: 20 });

      expect(page.items[0]).toEqual(
        expect.objectContaining({
          id: 'wl-1',
          hasPhoto: true,
          photoVersion: 2,
        }),
      );
      expect(JSON.stringify(page)).not.toContain('workout-photos');
    });
  });

  describe('history filters', () => {
    const where = async (has?: 'photo' | 'record', search?: string) => {
      logModel.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      await service.listForUser('me', { page: 1, limit: 20, has, search });
      return logModel.findAndCountAll.mock.calls.at(-1)?.[0].where;
    };

    it('keeps only workouts with a photo', async () => {
      const filter = await where('photo');
      expect(filter[Op.and]).toEqual([{ photoPublicId: { [Op.ne]: null } }]);
    });

    // "sala" finds "Sală", and a search and a chip narrow together rather
    // than one overwriting the other.
    it('searches the name blind to accents, beside a chip', async () => {
      const filter = await where('photo', 'Sală');
      const [search, chip] = filter[Op.and] as [{ sql: string }, unknown];
      expect(search.sql).toContain(foldedLike('"WorkoutLog"."name"', 'Sala'));
      expect(chip).toEqual({ photoPublicId: { [Op.ne]: null } });
    });

    // "bench" finds the workouts that had a bench press in them, by the
    // name logged or by the catalog's names in every language.
    it('searches the exercises in a workout too', async () => {
      const filter = await where(undefined, 'Împins');
      const [search] = filter[Op.and] as [{ sql: string }];
      expect(search.sql).toContain('EXISTS (');
      expect(search.sql).toContain('le.workout_log_id = "WorkoutLog"."id"');
      expect(search.sql).toContain(
        foldedLike('le.exercise_name_snapshot', 'Impins'),
      );
      expect(search.sql).toContain(foldedLike('e.search_name', 'Impins'));
    });

    // The same rule as the record count: a best set inside the workout
    // that beat an earlier one, never a first time.
    it('keeps only workouts with a record', async () => {
      const filter = await where('record');
      const [clause] = filter[Op.and] as { sql: string }[];
      expect(clause.sql).toContain("orm.source = 'ESTIMATED_EPLEY'");
      expect(clause.sql).toContain('orm.recorded_at > (');
      expect(clause.sql).toContain('"WorkoutLog"."completed_at"');
    });
  });

  describe('memoryFor', () => {
    const now = new Date('2026-10-28T12:00:00Z');
    const oldWorkout = {
      id: 'wl-old',
      name: 'Leg day',
      completedAt: new Date('2026-09-28T18:00:00Z'),
      hasPhoto: true,
      photoVersion: 7,
    };

    it('is null when nothing from back then has been beaten', async () => {
      // Every span: no workouts, except one a month back with no gain.
      sequelize.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([oldWorkout])
        .mockResolvedValueOnce([]);

      await expect(service.memoryFor('me', 'en', now)).resolves.toBeNull();
      expect(sequelize.query).toHaveBeenCalledTimes(5);
    });

    it('pairs a workout a month back with the lift it has most improved since', async () => {
      sequelize.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([oldWorkout])
        .mockResolvedValueOnce([
          { exerciseId: 'ex-squat', fromKg: '80.00', toKg: '100.00' },
        ]);
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'ex-squat',
        name: 'Squat',
        translations: null,
      });

      await expect(service.memoryFor('me', 'en', now)).resolves.toEqual({
        monthsAgo: 1,
        workout: {
          id: 'wl-old',
          name: 'Leg day',
          completedAt: oldWorkout.completedAt,
          hasPhoto: true,
          photoVersion: 7,
        },
        exercise: { id: 'ex-squat', name: 'Squat', fromKg: 80, toKg: 100 },
      });
    });

    // The longer the span, the better the story: a year back wins over a
    // month back when both have improved.
    it('looks a year back first, a few days either side', async () => {
      sequelize.query
        .mockResolvedValueOnce([
          { ...oldWorkout, completedAt: new Date('2025-10-26T18:00:00Z') },
        ])
        .mockResolvedValueOnce([
          { exerciseId: 'ex-squat', fromKg: '60', toKg: '100' },
        ]);
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'ex-squat',
        name: 'Squat',
        translations: null,
      });

      const memory = await service.memoryFor('me', 'en', now);

      expect(memory?.monthsAgo).toBe(12);
      const { from, to } = sequelize.query.mock.calls[0][1].replacements;
      expect(from.toISOString().slice(0, 10)).toBe('2025-10-24');
      expect(to.toISOString().slice(0, 10)).toBe('2025-11-01');
    });
  });

  describe('findForProfile', () => {
    it('is a 404 for a workout this viewer cannot see there', async () => {
      logModel.findOne.mockResolvedValueOnce(null);
      await expect(
        service.findForProfile('owner', ['PUBLIC'], 'wl-1'),
      ).rejects.toMatchObject({
        response: { messageKey: 'workout.logNotFound' },
      });
      expect(logModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            id: 'wl-1',
            userId: 'owner',
            status: WorkoutLogStatus.Completed,
            visibility: { [Op.in]: ['PUBLIC'] },
            takenDownAt: null,
          }),
        }),
      );
    });

    it('returns only the safe summary', async () => {
      logModel.findOne.mockResolvedValueOnce({
        id: 'wl-1',
        userId: 'owner',
        status: WorkoutLogStatus.Completed,
        name: 'Leg day',
        startedAt: new Date('2026-10-22T16:00:00Z'),
        completedAt: new Date('2026-10-22T16:52:00Z'),
        durationSeconds: 3_120,
        shareCaption: 'First 100!',
        notes: 'Knee hurt a bit',
        photoPublicId: 'workout-photos/owner/wl-1',
        exercises: [{ sets: [{ isCompleted: true }, { isCompleted: false }] }],
      });
      oneRepMaxModel.findAll.mockResolvedValueOnce([]);

      await expect(
        service.findForProfile('owner', ['PUBLIC'], 'wl-1'),
      ).resolves.toEqual({
        id: 'wl-1',
        name: 'Leg day',
        completedAt: new Date('2026-10-22T16:52:00Z'),
        durationSeconds: 3_120,
        setsCompleted: 1,
        recordCount: 0,
        shareCaption: 'First 100!',
        hasPhoto: true,
        photoVersion: null,
      });
    });
  });

  describe('pause and resume', () => {
    const openLog = (fields: Record<string, unknown> = {}) => ({
      id: 'wl-1',
      userId: 'me',
      status: WorkoutLogStatus.InProgress,
      pausedAt: null,
      pausedSeconds: 0,
      update: jest.fn().mockResolvedValue(undefined),
      ...fields,
    });

    it('stamps pausedAt on a running workout', async () => {
      const log = openLog();
      logModel.findByPk.mockResolvedValueOnce(log);
      await service.pause('wl-1', 'me');
      expect(log.update).toHaveBeenCalledWith({ pausedAt: expect.any(Date) });
    });

    it('keeps the original start of a pause when paused again', async () => {
      const log = openLog({ pausedAt: new Date(Date.now() - 60_000) });
      logModel.findByPk.mockResolvedValueOnce(log);
      await service.pause('wl-1', 'me');
      expect(log.update).not.toHaveBeenCalled();
    });

    it('folds the pause into pausedSeconds on resume', async () => {
      const log = openLog({
        pausedAt: new Date(Date.now() - 90_000),
        pausedSeconds: 30,
      });
      logModel.findByPk.mockResolvedValueOnce(log);
      await service.resume('wl-1', 'me');
      const args = log.update.mock.calls[0][0];
      expect(args.pausedAt).toBeNull();
      expect(args.pausedSeconds).toBeGreaterThanOrEqual(119);
      expect(args.pausedSeconds).toBeLessThanOrEqual(121);
    });

    it('ends the pause when Continue was tapped, saved later', async () => {
      const pausedAt = new Date(Date.now() - 10 * 60_000);
      const log = openLog({ pausedAt, pausedSeconds: 30 });
      logModel.findByPk.mockResolvedValueOnce(log);
      const tapped = new Date(pausedAt.getTime() + 4 * 60_000);
      await service.resume('wl-1', 'me', tapped.toISOString());
      expect(log.update).toHaveBeenCalledWith({
        pausedAt: null,
        pausedSeconds: 30 + 4 * 60,
      });
    });

    it('holds a sent time inside the pause', async () => {
      const pausedAt = new Date(Date.now() - 60_000);
      const early = openLog({ pausedAt, pausedSeconds: 0 });
      logModel.findByPk.mockResolvedValueOnce(early);
      await service.resume('wl-1', 'me', '2020-01-01T00:00:00.000Z');
      expect(early.update).toHaveBeenCalledWith({
        pausedAt: null,
        pausedSeconds: 0,
      });

      const late = openLog({ pausedAt, pausedSeconds: 0 });
      logModel.findByPk.mockResolvedValueOnce(late);
      await service.resume('wl-1', 'me', '2099-01-01T00:00:00.000Z');
      const args = late.update.mock.calls[0][0] as { pausedSeconds: number };
      expect(args.pausedSeconds).toBeGreaterThanOrEqual(59);
      expect(args.pausedSeconds).toBeLessThanOrEqual(61);
    });

    it('does nothing when resuming a running workout', async () => {
      const log = openLog();
      logModel.findByPk.mockResolvedValueOnce(log);
      await service.resume('wl-1', 'me');
      expect(log.update).not.toHaveBeenCalled();
    });

    it('refuses to pause a finished workout', async () => {
      logModel.findByPk.mockResolvedValueOnce(
        openLog({ status: WorkoutLogStatus.Completed }),
      );
      await expect(service.pause('wl-1', 'me')).rejects.toThrow(
        BadRequestException,
      );
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

    describe('records and the summary', () => {
      const startedAt = new Date('2026-10-22T17:00:00Z');
      const completedAt = new Date('2026-10-22T17:52:00Z');

      function finishedLog(fields: Record<string, unknown> = {}) {
        const plain = { id: 'wl-1', userId: 'me' };
        return {
          id: 'wl-1',
          userId: 'me',
          status: WorkoutLogStatus.Completed,
          startedAt,
          completedAt,
          sourceProgramId: null,
          sourceProgram: null,
          exercises: [
            {
              exerciseId: 'squat',
              sets: [
                { isCompleted: true, weightKg: '90.00', reps: 8 },
                { isCompleted: true, weightKg: '100.00', reps: 5 },
                { isCompleted: false, weightKg: '110.00', reps: 5 },
              ],
            },
          ],
          get: () => plain,
          ...fields,
        };
      }

      const pr = (exerciseId: string) => ({
        id: `orm-${exerciseId}`,
        exerciseId,
        weightKg: 116.67,
        recordedAt: completedAt,
        exercise: { id: exerciseId, name: exerciseId, translations: null },
      });

      it('names the set behind a record and skips a first time', async () => {
        logModel.findByPk.mockResolvedValueOnce(finishedLog());
        oneRepMaxModel.findAll.mockResolvedValueOnce([
          pr('squat'),
          pr('deadlift'),
        ]);
        // Squat beat an earlier 105; deadlift had never been done.
        oneRepMaxModel.findOne
          .mockResolvedValueOnce({ weightKg: 105 })
          .mockResolvedValueOnce(null);

        const out = (await service.findById('wl-1', 'me')) as unknown as {
          personalRecords?: Record<string, unknown>[];
        };

        expect(out.personalRecords).toEqual([
          expect.objectContaining({
            exerciseId: 'squat',
            deltaKg: 11.67,
            // 100 × 5 (Epley 116.7) beats 90 × 8 (114); unticked sets
            // never count.
            setWeightKg: 100,
            setReps: 5,
          }),
        ]);
      });

      it('leaves out the summary unless the owner route asks for it', async () => {
        logModel.findByPk.mockResolvedValueOnce(finishedLog());
        oneRepMaxModel.findAll.mockResolvedValueOnce([]);

        const out = (await service.findById('wl-1', 'me')) as unknown as {
          summary?: unknown;
        };

        expect(out.summary).toBeUndefined();
        expect(logModel.count).not.toHaveBeenCalled();
        expect(sequelize.query).not.toHaveBeenCalled();
      });

      it('counts the workout, the streak and last time for a routine', async () => {
        logModel.findByPk.mockResolvedValueOnce(
          finishedLog({
            sourceProgramId: 'routine-1',
            sourceProgram: { id: 'routine-1', isSingleWorkout: true },
          }),
        );
        oneRepMaxModel.findAll.mockResolvedValueOnce([]);
        logModel.count.mockResolvedValueOnce(12);
        const monday = (weeksBack: number) => {
          const now = new Date();
          const t = Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate() - ((now.getUTCDay() + 6) % 7) - weeksBack * 7,
          );
          return new Date(t).toISOString().slice(0, 10);
        };
        // In call order: the weeks, the previous time this routine was
        // done, then each exercise's last session.
        sequelize.query
          .mockResolvedValueOnce([
            { weekStart: monday(0) },
            { weekStart: monday(1) },
            { weekStart: monday(2) },
          ])
          .mockResolvedValueOnce([
            {
              workoutLogId: 'wl-0',
              name: 'Leg day',
              completedAt: new Date('2026-10-15T18:00:00Z'),
              totalKg: '5780.40',
            },
          ])
          .mockResolvedValueOnce([]);

        const out = (await service.findById('wl-1', 'me', undefined, {
          summary: true,
        })) as unknown as { summary?: Record<string, unknown> };

        expect(out.summary).toEqual({
          workoutNumber: 12,
          streakWeeks: 3,
          previousVolumeKg: 5780,
          volume: expect.objectContaining({ totalKg: 1220 }),
          coachName: null,
          mentionableCoach: null,
        });
      });

      it.each([
        [
          'names the coach behind a plan workout',
          'COACH',
          'coach-1',
          'Bogdan Daniel',
        ],
        ['never names you as your own coach', 'SELF', 'me', null],
      ])('%s', async (_title, assignmentKind, instructorId, expected) => {
        logModel.findByPk.mockResolvedValueOnce(
          finishedLog({ programAssignmentId: 'asg-1' }),
        );
        oneRepMaxModel.findAll.mockResolvedValueOnce([]);
        logModel.count.mockResolvedValueOnce(4);
        sequelize.query.mockResolvedValueOnce([]);
        assignmentModel.findByPk.mockResolvedValueOnce({
          id: 'asg-1',
          assignmentKind,
          instructorId,
          instructor: { firstName: 'Bogdan', lastName: 'Daniel' },
        });

        const out = (await service.findById('wl-1', 'me', undefined, {
          summary: true,
        })) as unknown as { summary?: { coachName: unknown } };

        expect(out.summary?.coachName).toBe(expected);
      });

      describe('the coach a shared card may name', () => {
        type Summary = { coachName: unknown; mentionableCoach: unknown };

        async function summaryFor(
          assignment: Record<string, unknown>,
        ): Promise<Summary | undefined> {
          logModel.findByPk.mockResolvedValueOnce(
            finishedLog({ programAssignmentId: 'asg-1' }),
          );
          oneRepMaxModel.findAll.mockResolvedValueOnce([]);
          logModel.count.mockResolvedValueOnce(4);
          sequelize.query.mockResolvedValueOnce([]);
          assignmentModel.findByPk.mockResolvedValueOnce({
            id: 'asg-1',
            assignmentKind: 'COACH',
            instructorId: 'coach-1',
            ...assignment,
          });
          const out = (await service.findById('wl-1', 'me', undefined, {
            summary: true,
          })) as unknown as { summary?: Summary };
          return out.summary;
        }

        const coach = {
          id: 'coach-1',
          firstName: 'Bogdan',
          lastName: 'Daniel',
          handle: 'bogdan',
          isActive: true,
        };

        it('names a coach who lets clients mention them, by their coaching name', async () => {
          instructorProfileModel.findOne.mockResolvedValueOnce({
            id: 'ip-1',
            displayName: 'Coach Bogdan',
            allowClientMentions: true,
          });

          const summary = await summaryFor({ instructor: coach });

          expect(summary?.coachName).toBe('Bogdan Daniel');
          expect(summary?.mentionableCoach).toEqual({ name: 'Coach Bogdan' });
          expect(instructorProfileModel.findOne).toHaveBeenCalledWith(
            expect.objectContaining({ where: { userId: 'coach-1' } }),
          );
        });

        it('falls back to the full name', async () => {
          instructorProfileModel.findOne.mockResolvedValueOnce({
            id: 'ip-1',
            displayName: '  ',
            allowClientMentions: true,
          });

          const summary = await summaryFor({
            instructor: { ...coach, handle: null },
          });

          expect(summary?.mentionableCoach).toEqual({ name: 'Bogdan Daniel' });
        });

        it('keeps the coach line off until the coach allows it', async () => {
          instructorProfileModel.findOne.mockResolvedValueOnce({
            id: 'ip-1',
            displayName: 'Coach Bogdan',
            allowClientMentions: false,
          });

          const summary = await summaryFor({ instructor: coach });

          // The in-app name stays; only the outside mention needs consent.
          expect(summary?.coachName).toBe('Bogdan Daniel');
          expect(summary?.mentionableCoach).toBeNull();
        });

        it('names nobody for a coach without a coaching profile', async () => {
          instructorProfileModel.findOne.mockResolvedValueOnce(null);

          const summary = await summaryFor({ instructor: coach });

          expect(summary?.mentionableCoach).toBeNull();
        });

        it('never names a closing account', async () => {
          const summary = await summaryFor({
            instructor: { ...coach, isActive: false },
          });

          expect(summary?.coachName).toBe('Bogdan Daniel');
          expect(summary?.mentionableCoach).toBeNull();
          expect(instructorProfileModel.findOne).not.toHaveBeenCalled();
        });

        it('never asks for your own plan', async () => {
          const summary = await summaryFor({
            assignmentKind: 'SELF',
            instructorId: 'me',
            instructor: { ...coach, id: 'me' },
          });

          expect(summary?.coachName).toBeNull();
          expect(summary?.mentionableCoach).toBeNull();
          expect(instructorProfileModel.findOne).not.toHaveBeenCalled();
        });

        it('has no coach for freestyle', async () => {
          logModel.findByPk.mockResolvedValueOnce(finishedLog());
          oneRepMaxModel.findAll.mockResolvedValueOnce([]);
          logModel.count.mockResolvedValueOnce(4);
          sequelize.query.mockResolvedValueOnce([]);

          const out = (await service.findById('wl-1', 'me', undefined, {
            summary: true,
          })) as unknown as { summary?: Summary };

          expect(out.summary?.mentionableCoach).toBeNull();
          expect(assignmentModel.findByPk).not.toHaveBeenCalled();
          expect(instructorProfileModel.findOne).not.toHaveBeenCalled();
        });
      });

      it('keeps previousVolumeKg to routines', async () => {
        logModel.findByPk.mockResolvedValueOnce(
          finishedLog({
            sourceProgramId: 'plan-1',
            sourceProgram: { id: 'plan-1', isSingleWorkout: false },
          }),
        );
        oneRepMaxModel.findAll.mockResolvedValueOnce([]);
        logModel.count.mockResolvedValueOnce(3);
        sequelize.query
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            {
              workoutLogId: 'wl-0',
              name: 'Week 1 day 1',
              completedAt: new Date('2026-10-15T18:00:00Z'),
              totalKg: '900',
            },
          ])
          .mockResolvedValueOnce([]);

        const out = (await service.findById('wl-1', 'me', undefined, {
          summary: true,
        })) as unknown as {
          summary?: {
            previousVolumeKg: unknown;
            volume: { previous: unknown };
          };
        };

        // The older field stays routine-only; the volume block compares
        // the program's day as well.
        expect(out.summary?.previousVolumeKg).toBeNull();
        expect(out.summary?.volume.previous).toEqual(
          expect.objectContaining({ workoutLogId: 'wl-0', totalKg: 900 }),
        );
      });

      describe('volume against last time', () => {
        type Volume = {
          totalKg: number;
          previous: Record<string, unknown> | null;
          changeKg: number | null;
          changePercent: number | null;
          exercises: Array<Record<string, unknown>>;
        };

        const set = (fields: Record<string, unknown>) => ({
          isCompleted: true,
          setType: 'NORMAL',
          weightKg: null,
          reps: null,
          durationSeconds: null,
          distanceMeters: null,
          ...fields,
        });

        /** A Push day: bench with a warm-up, push-ups, a plank, bench again. */
        const pushDay = (fields: Record<string, unknown> = {}) =>
          finishedLog({
            exercises: [
              {
                id: 'le-bench',
                exerciseId: 'bench',
                isSkipped: false,
                exercise: { kind: 'STRENGTH' },
                sets: [
                  set({ setType: 'WARMUP', weightKg: '40.00', reps: 10 }),
                  set({ weightKg: '60.00', reps: 8 }),
                  set({ weightKg: '60.00', reps: 8 }),
                  set({ weightKg: '60.00', reps: 8, isCompleted: false }),
                ],
              },
              {
                id: 'le-pushup',
                exerciseId: 'pushup',
                isSkipped: false,
                exercise: { kind: 'BODYWEIGHT' },
                sets: [set({ reps: 15 }), set({ reps: 12 })],
              },
              {
                id: 'le-plank',
                exerciseId: 'plank',
                isSkipped: false,
                exercise: { kind: 'DURATION' },
                sets: [
                  set({ durationSeconds: 60 }),
                  set({ durationSeconds: 45 }),
                ],
              },
              {
                id: 'le-fly',
                exerciseId: 'fly',
                isSkipped: true,
                exercise: { kind: 'STRENGTH' },
                sets: [],
              },
              {
                id: 'le-bench-2',
                exerciseId: 'bench',
                isSkipped: false,
                exercise: { kind: 'STRENGTH' },
                sets: [set({ weightKg: '50.00', reps: 10 })],
              },
            ],
            ...fields,
          });

        /**
         * `previous` is what the "same workout" query answers, or null when
         * the log has nothing to match on and that query never runs.
         */
        async function volumeOf(
          log: ReturnType<typeof finishedLog>,
          previous: unknown[] | null,
          lastSessions: unknown[],
        ): Promise<Volume> {
          logModel.findByPk.mockResolvedValueOnce(log);
          oneRepMaxModel.findAll.mockResolvedValueOnce([]);
          logModel.count.mockResolvedValueOnce(5);
          // In call order: the weeks, the same workout, the last sessions.
          const answers = [[], ...(previous ? [previous] : []), lastSessions];
          for (const rows of answers) {
            sequelize.query.mockResolvedValueOnce(rows);
          }
          const out = (await service.findById('wl-1', 'me', undefined, {
            summary: true,
          })) as unknown as { summary: { volume: Volume } };
          return out.summary.volume;
        }

        const sqlCalls = () =>
          (
            sequelize.query.mock.calls as Array<
              [string, { replacements: Record<string, unknown> }]
            >
          ).map(([sql, opts]) => ({ sql, args: opts.replacements }));

        it('compares the total with the last time this routine was done', async () => {
          const volume = await volumeOf(
            pushDay({
              sourceProgramId: 'routine-1',
              sourceProgram: { id: 'routine-1', isSingleWorkout: true },
            }),
            [
              {
                workoutLogId: 'wl-0',
                name: 'Push day',
                completedAt: new Date('2026-10-15T18:00:00Z'),
                totalKg: '1240.00',
              },
            ],
            [
              {
                exerciseId: 'bench',
                workoutLogId: 'wl-0',
                performedAt: new Date('2026-10-15T18:00:00Z'),
                volumeKg: '1280.00',
                volumeReps: '24',
                volumeSeconds: '0',
                volumeMeters: '0',
              },
              {
                exerciseId: 'pushup',
                workoutLogId: 'wl-x',
                performedAt: new Date('2026-10-12T18:00:00Z'),
                volumeKg: '0',
                volumeReps: '30',
                volumeSeconds: '0',
                volumeMeters: '0',
              },
            ],
          );

          // 60 × 8 twice and 50 × 10: the warm-up and the unticked set
          // are out, and the skipped fly too.
          expect(volume.totalKg).toBe(1460);
          expect(volume.previous).toEqual({
            workoutLogId: 'wl-0',
            name: 'Push day',
            completedAt: new Date('2026-10-15T18:00:00Z'),
            totalKg: 1240,
          });
          expect(volume.changeKg).toBe(220);
          expect(volume.changePercent).toBe(18);
          expect(volume.exercises).toEqual([
            {
              exerciseId: 'bench',
              loggedExerciseId: 'le-bench',
              unit: 'kg',
              volume: 1460,
              previous: {
                workoutLogId: 'wl-0',
                performedAt: new Date('2026-10-15T18:00:00Z'),
                volume: 1280,
              },
              changePercent: 14,
            },
            {
              exerciseId: 'pushup',
              loggedExerciseId: 'le-pushup',
              unit: 'reps',
              volume: 27,
              previous: {
                workoutLogId: 'wl-x',
                performedAt: new Date('2026-10-12T18:00:00Z'),
                volume: 30,
              },
              changePercent: -10,
            },
            {
              exerciseId: 'plank',
              loggedExerciseId: 'le-plank',
              unit: 'seconds',
              volume: 105,
              previous: null,
              changePercent: null,
            },
          ]);

          const [, same, last] = sqlCalls();
          // The same routine, started on its own or scheduled.
          expect(same.sql).toContain('wl.source_program_id = :sourceProgramId');
          expect(same.sql).toContain('pw.program_id = :sourceProgramId');
          expect(same.sql).toContain("ls.set_type <> 'WARMUP'");
          expect(same.args).toEqual(
            expect.objectContaining({
              sourceProgramId: 'routine-1',
              logId: 'wl-1',
            }),
          );
          expect(last.sql).toContain("ls.set_type <> 'WARMUP'");
          expect(last.args.exerciseIds).toEqual(['bench', 'pushup', 'plank']);
        });

        it('compares a plan day by the program day it was copied from', async () => {
          const volume = await volumeOf(
            pushDay({
              assignedWorkoutId: 'aw-9',
              programAssignmentId: 'asg-1',
            }),
            [],
            [],
          );

          // First time on this day: nothing to compare yet.
          expect(volume.previous).toBeNull();
          expect(volume.changeKg).toBeNull();
          const [, same] = sqlCalls();
          expect(same.sql).toContain('aw.master_workout_id = (');
          // A routine scheduled through the plan matches its own runs too.
          expect(same.sql).toContain('p.is_single_workout = TRUE');
          expect(same.sql).not.toContain(':sourceProgramId');
          expect(same.args).toEqual(
            expect.objectContaining({ assignedWorkoutId: 'aw-9' }),
          );
        });

        it('has no previous workout for freestyle, but still compares exercises', async () => {
          const volume = await volumeOf(pushDay(), null, [
            {
              exerciseId: 'plank',
              workoutLogId: 'wl-x',
              performedAt: new Date('2026-10-12T18:00:00Z'),
              volumeKg: '0',
              volumeReps: '0',
              volumeSeconds: '90',
              volumeMeters: '0',
            },
          ]);

          expect(volume.previous).toBeNull();
          expect(volume.changePercent).toBeNull();
          expect(
            volume.exercises.find((e) => e.exerciseId === 'plank'),
          ).toEqual(
            expect.objectContaining({ volume: 105, changePercent: 17 }),
          );
          // Only the weeks and the last sessions: no "same workout" query.
          expect(sequelize.query).toHaveBeenCalledTimes(2);
        });

        it('reads a last time in another unit as no comparison', async () => {
          const volume = await volumeOf(pushDay(), null, [
            {
              exerciseId: 'bench',
              workoutLogId: 'wl-x',
              performedAt: new Date('2026-10-12T18:00:00Z'),
              // Bench done for time once: nothing in kilograms.
              volumeKg: '0',
              volumeReps: '0',
              volumeSeconds: '120',
              volumeMeters: '0',
            },
          ]);

          expect(volume.exercises[0]).toEqual(
            expect.objectContaining({
              exerciseId: 'bench',
              previous: null,
              changePercent: null,
            }),
          );
        });
      });
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

  // ─── Mid-session: remove set ─────────────────────────────────────

  describe('removeSetFromLog', () => {
    const inProgressLog = {
      id: 'wl-1',
      userId: 'me',
      status: WorkoutLogStatus.InProgress,
    };
    const destroySets = jest.fn();

    beforeEach(() => {
      destroySets.mockReset().mockResolvedValue(1);
      (loggedSetModel as Record<string, jest.Mock>).destroy = destroySets;
    });

    it('refuses on a completed log', async () => {
      logModel.findByPk.mockResolvedValueOnce({
        ...inProgressLog,
        status: WorkoutLogStatus.Completed,
      });
      await expect(
        service.removeSetFromLog('wl-1', 'ls-1', 'me'),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s when the set belongs to a different log', async () => {
      logModel.findByPk.mockResolvedValueOnce(inProgressLog);
      // The query is scoped to this log, so another log's set is not found.
      loggedSetModel.findAll.mockResolvedValueOnce([]);
      await expect(
        service.removeSetFromLog('wl-1', 'ls-1', 'me'),
      ).rejects.toThrow(NotFoundException);
      expect(destroySets).not.toHaveBeenCalled();
    });

    it('deletes the row on the happy path', async () => {
      logModel.findByPk.mockResolvedValueOnce(inProgressLog);
      loggedSetModel.findAll.mockResolvedValueOnce([{ id: 'ls-1' }]);
      await service.removeSetFromLog('wl-1', 'ls-1', 'me');
      expect(destroySets).toHaveBeenCalledWith({
        where: { id: ['ls-1'] },
        transaction: fakeTx,
      });
    });
  });

  describe('removeSetsFromLog', () => {
    const inProgressLog = {
      id: 'wl-1',
      userId: 'me',
      status: WorkoutLogStatus.InProgress,
    };
    const destroySets = jest.fn();

    beforeEach(() => {
      destroySets.mockReset().mockResolvedValue(2);
      (loggedSetModel as Record<string, jest.Mock>).destroy = destroySets;
    });

    it('deletes the whole round in one transaction', async () => {
      logModel.findByPk.mockResolvedValueOnce(inProgressLog);
      loggedSetModel.findAll.mockResolvedValueOnce([
        { id: 'ls-1' },
        { id: 'ls-2' },
      ]);

      await service.removeSetsFromLog('wl-1', ['ls-1', 'ls-2'], 'me');

      const [query] = loggedSetModel.findAll.mock.calls[0] as [
        { where: { id: string[] }; include: { where: unknown }[] },
      ];
      expect(query.where.id).toEqual(['ls-1', 'ls-2']);
      expect(query.include[0].where).toEqual({ workoutLogId: 'wl-1' });
      expect(destroySets).toHaveBeenCalledWith({
        where: { id: ['ls-1', 'ls-2'] },
        transaction: fakeTx,
      });
    });

    it('deletes nothing when one set is not in this workout', async () => {
      logModel.findByPk.mockResolvedValueOnce(inProgressLog);
      loggedSetModel.findAll.mockResolvedValueOnce([{ id: 'ls-1' }]);

      await expect(
        service.removeSetsFromLog('wl-1', ['ls-1', 'ls-other'], 'me'),
      ).rejects.toThrow(NotFoundException);
      expect(destroySets).not.toHaveBeenCalled();
    });

    it('refuses on a finished workout', async () => {
      logModel.findByPk.mockResolvedValueOnce({
        ...inProgressLog,
        status: WorkoutLogStatus.Completed,
      });

      await expect(
        service.removeSetsFromLog('wl-1', ['ls-1'], 'me'),
      ).rejects.toThrow(BadRequestException);
      expect(destroySets).not.toHaveBeenCalled();
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

  describe('listHistory', () => {
    /** The trainee's own timeline query, from one call. */
    const history = async (query: Record<string, unknown>) => {
      sequelize.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: '0' }]);
      logModel.findAndCountAll.mockResolvedValueOnce({ rows: [], count: 0 });
      await service.listHistory('user-1', { page: 1, limit: 20, ...query });
      return sequelize.query.mock.calls[0] as
        | [string, { replacements: Record<string, unknown> }]
        | undefined;
    };

    afterEach(() => {
      sequelize.query.mockReset();
      logModel.findAndCountAll.mockReset();
    });

    it('reads every finished workout and the skipped days of all their plans', async () => {
      const call = await history({ kind: 'all' });
      expect(call).toBeDefined();
      const [sql, { replacements }] = call!;
      expect(sql).toContain("wl.status = 'COMPLETED'");
      // Their own: no coach visibility rule.
      expect(sql).not.toContain(':shared');
      expect(sql).toContain(
        'pa.client_id = :clientId AND pa.deleted_at IS NULL',
      );
      expect(replacements.clientId).toBe('user-1');
      expect(logModel.findAndCountAll).not.toHaveBeenCalled();
    });

    it('keeps to the logs under a photo or record chip, a search, or no kind', async () => {
      for (const query of [
        { kind: 'all', has: 'record' },
        { kind: 'all', search: 'push' },
        {},
      ]) {
        sequelize.query.mockReset();
        logModel.findAndCountAll.mockReset();
        const call = await history(query);
        expect(call).toBeUndefined();
        expect(logModel.findAndCountAll).toHaveBeenCalled();
      }
    });
  });

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

    /** An ACTIVE link with these assignments of the coach's, then the timeline. */
    const timeline = async (
      query: Record<string, unknown>,
      entries: Array<Record<string, unknown>> = [],
      ownIds: string[] = ['asg-1'],
    ) => {
      instructorClientModel.findOne.mockResolvedValueOnce({ id: 'link-1' });
      assignmentModel.findAll.mockResolvedValueOnce(
        ownIds.map((id) => ({ id, shareOffPlan: false })),
      );
      sequelize.query
        .mockResolvedValueOnce(entries)
        .mockResolvedValueOnce([{ total: String(entries.length) }]);
      const out = await service.listForClientByInstructor(
        'coach-1',
        'client-1',
        {
          page: 1,
          limit: 20,
          ...query,
        },
      );
      const [sql, options] = sequelize.query.mock.calls[0] as [
        string,
        { replacements: Record<string, unknown> },
      ];
      return { out, sql, replacements: options.replacements };
    };

    it('reads only the finished logs when no kind is named, as before the skips', async () => {
      const { sql } = await timeline({});
      expect(sql).toContain('FROM workout_log');
      expect(sql).not.toContain('assigned_workout');
    });

    it("reads the client's finished logs the coach may see, and the skips of the coach's plans", async () => {
      const { sql, replacements } = await timeline({ kind: 'all' });
      expect(sql).toContain("wl.status = 'COMPLETED'");
      expect(sql).toContain(
        'wl.program_assignment_id IN (:own) OR wl.visibility IN (:shared)',
      );
      expect(sql).toContain("aw.status = 'SKIPPED'");
      expect(replacements).toEqual(
        expect.objectContaining({
          clientId: 'client-1',
          own: ['asg-1'],
          shared: ['COACHES_ONLY', 'PUBLIC'],
        }),
      );
    });

    it('narrows to the plan, to what is their own, or to the skips', async () => {
      const plan = (await timeline({ kind: 'plan' })).sql;
      expect(plan).toContain('AND wl.program_assignment_id IN (:own)');
      expect(plan).not.toContain("aw.status = 'SKIPPED'");
      sequelize.query.mockReset();
      const own = (await timeline({ kind: 'own' })).sql;
      expect(own).toContain(
        'AND NOT COALESCE(wl.program_assignment_id IN (:own), FALSE)',
      );
      expect(own).not.toContain("aw.status = 'SKIPPED'");
      sequelize.query.mockReset();
      const skipped = (await timeline({ kind: 'skipped' })).sql;
      expect(skipped).not.toContain('FROM workout_log');
      expect(skipped).toContain("aw.status = 'SKIPPED'");
    });

    it('shows no skips, and nothing from a plan, to a coach with no plan for them', async () => {
      const { sql, replacements } = await timeline({ kind: 'plan' }, [], []);
      expect(sql).not.toContain(':own');
      expect(sql).toContain('AND FALSE');
      expect(replacements).not.toHaveProperty('own');
    });

    it('bounds the day for a calendar month', async () => {
      const { sql, replacements } = await timeline({
        dateFrom: '2026-10-01T00:00:00Z',
        dateTo: '2026-11-01T00:00:00Z',
      });
      expect(sql).toContain('WHERE at >= :dateFrom AND at < :dateTo');
      expect(replacements.dateFrom).toEqual(new Date('2026-10-01T00:00:00Z'));
      expect(replacements.dateTo).toEqual(new Date('2026-11-01T00:00:00Z'));
    });

    it('keeps the timeline order, logs as history rows and a skip as a row with nothing to open', async () => {
      logModel.findAll.mockResolvedValueOnce([
        {
          id: 'log-1',
          status: 'COMPLETED',
          completedAt: null,
          get() {
            return {
              id: 'log-1',
              status: 'COMPLETED',
              photoPublicId: 'secret/id',
            };
          },
        },
      ]);
      const { out } = await timeline({ kind: 'all' }, [
        {
          id: 'aw-1',
          kind: 'SKIPPED',
          at: '2026-10-23T12:00:00.000Z',
          name: 'Full body A',
          assignment_id: 'asg-1',
          program_name: 'Strength Base',
          assignment_kind: 'COACH',
          master_program_id: 'prog-1',
        },
        { id: 'log-1', kind: 'LOG', at: '2026-10-21T16:00:00.000Z' },
      ]);
      expect(out.total).toBe(2);
      expect(out.items[0]).toEqual(
        expect.objectContaining({
          id: 'aw-1',
          status: 'SKIPPED',
          name: 'Full body A',
          assignedWorkoutId: 'aw-1',
          programAssignmentId: 'asg-1',
          exercises: [],
        }),
      );
      expect(out.items[1]).toEqual({
        id: 'log-1',
        status: 'COMPLETED',
        hasPhoto: true,
      });
    });
  });

  describe('off-plan privacy', () => {
    /** The coach's timeline query: their plans, or what was shared. */
    async function coachQuery(assignments: Record<string, unknown>[]) {
      instructorClientModel.findOne.mockResolvedValueOnce({ id: 'link-1' });
      assignmentModel.findAll.mockResolvedValueOnce(assignments);
      sequelize.query
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ total: '0' }]);
      await service.listForClientByInstructor('coach-1', 'client-1', {
        page: 1,
        limit: 20,
      });
      const [sql, options] = sequelize.query.mock.calls[0] as [
        string,
        { replacements: Record<string, unknown> },
      ];
      return { sql, replacements: options.replacements };
    }

    it('limits the coach to their own plans and what the client shared', async () => {
      const { sql, replacements } = await coachQuery([
        { id: 'asg-1' },
        { id: 'asg-2' },
      ]);
      expect(sql).toContain(
        '(wl.program_assignment_id IN (:own) OR wl.visibility IN (:shared))',
      );
      expect(replacements.own).toEqual(['asg-1', 'asg-2']);
      expect(replacements.shared).toEqual(['COACHES_ONLY', 'PUBLIC']);
    });

    it('leaves a coach with no plans only what was shared', async () => {
      const { sql, replacements } = await coachQuery([]);
      expect(sql).toContain('(FALSE OR wl.visibility IN (:shared))');
      // No plan of theirs, so no skipped days of one either.
      expect(sql).not.toContain('assigned_workout');
      expect(replacements).not.toHaveProperty('own');
    });

    // Nothing could ever set it; migration 073 carried its few values over.
    it('no longer opens everything for the old share_off_plan flag', async () => {
      const { sql } = await coachQuery([{ id: 'asg-1', shareOffPlan: true }]);
      expect(sql).toContain('OR wl.visibility IN (:shared))');
    });

    it('404s on a private freestyle log', async () => {
      logModel.findByPk.mockResolvedValueOnce({
        userId: 'client-1',
        programAssignmentId: null,
        visibility: 'ONLY_ME',
      });
      instructorClientModel.findOne.mockResolvedValueOnce({ id: 'link-1' });
      assignmentModel.findAll.mockResolvedValueOnce([{ id: 'asg-1' }]);

      await expect(
        service.findByIdForInstructor('log-solo', 'coach-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('opens a freestyle log the client shared with coaches', async () => {
      const plain = { id: 'log-solo', userId: 'client-1' };
      logModel.findByPk
        .mockResolvedValueOnce({
          userId: 'client-1',
          programAssignmentId: null,
          visibility: 'COACHES_ONLY',
        })
        .mockResolvedValueOnce({
          ...plain,
          status: WorkoutLogStatus.Completed,
          completedAt: null,
          startedAt: new Date(),
          get: () => plain,
        });
      instructorClientModel.findOne.mockResolvedValueOnce({ id: 'link-1' });
      assignmentModel.findAll.mockResolvedValueOnce([{ id: 'asg-1' }]);

      await expect(
        service.findByIdForInstructor('log-solo', 'coach-1'),
      ).resolves.toEqual({ ...plain, hasPhoto: false });
    });

    it('stays closed when a log arrives without its level', async () => {
      logModel.findByPk.mockResolvedValueOnce({
        userId: 'client-1',
        programAssignmentId: null,
      });
      instructorClientModel.findOne.mockResolvedValueOnce({ id: 'link-1' });
      assignmentModel.findAll.mockResolvedValueOnce([{ id: 'asg-1' }]);

      await expect(
        service.findByIdForInstructor('log-solo', 'coach-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("404s on a private log from another coach's assignment", async () => {
      logModel.findByPk.mockResolvedValueOnce({
        userId: 'client-1',
        programAssignmentId: 'asg-other',
        visibility: 'ONLY_ME',
      });
      instructorClientModel.findOne.mockResolvedValueOnce({ id: 'link-1' });
      assignmentModel.findAll.mockResolvedValueOnce([{ id: 'asg-1' }]);

      await expect(
        service.findByIdForInstructor('log-x', 'coach-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('listForProfile — what a profile may show', () => {
    it('lists only the given levels, as a summary with no note or weights', async () => {
      const row = {
        id: 'wl-1',
        name: 'Leg day',
        completedAt: new Date('2026-10-22T17:52:00Z'),
        startedAt: new Date('2026-10-22T17:00:00Z'),
        status: WorkoutLogStatus.Completed,
        userId: 'me',
        durationSeconds: 3134,
        notes: 'knee hurt, told no one',
        shareCaption: 'First 100!',
        visibility: 'PUBLIC',
        assignment: { programNameSnapshot: 'Coach plan' },
        exercises: [
          {
            sets: [
              { isCompleted: true, weightKg: 100 },
              { isCompleted: false, weightKg: 100 },
            ],
          },
        ],
      };
      logModel.findAndCountAll.mockResolvedValueOnce({
        rows: [{ ...row, get: () => row }],
        count: 1,
      });
      oneRepMaxModel.findAll.mockResolvedValueOnce([]);

      const out = await service.listForProfile('me', ['PUBLIC'], {
        page: 1,
        limit: 20,
      });

      const { where } = logModel.findAndCountAll.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(where.visibility).toEqual({ [Op.in]: ['PUBLIC'] });
      // A workout staff took down never shows on a profile.
      expect(where).toHaveProperty('takenDownAt', null);
      expect(out.items).toEqual([
        {
          id: 'wl-1',
          name: 'Leg day',
          completedAt: row.completedAt,
          durationSeconds: 3134,
          setsCompleted: 1,
          recordCount: 0,
          shareCaption: 'First 100!',
          hasPhoto: false,
          photoVersion: null,
        },
      ]);
    });
  });

  describe('workouts shared into posts', () => {
    const log = (id: string, userId: string, visibility: string) => ({
      id,
      userId,
      name: id,
      status: WorkoutLogStatus.Completed,
      startedAt: new Date('2026-10-22T17:00:00Z'),
      completedAt: new Date('2026-10-22T18:00:00Z'),
      durationSeconds: 3600,
      shareCaption: null,
      notes: 'private',
      visibility,
      exercises: [{ sets: [{ isCompleted: true }] }],
    });

    it('builds one card per workout, records counted per author', async () => {
      logModel.findAll.mockResolvedValueOnce([
        log('wl-a', 'ana', 'PUBLIC'),
        log('wl-b', 'bob', 'ONLY_ME'),
      ]);
      // One record lookup per author: a feed mixes people.
      oneRepMaxModel.findAll.mockResolvedValue([]);

      const cards = await service.summariesForPosts(['wl-a', 'wl-b']);

      expect(oneRepMaxModel.findAll).toHaveBeenCalledTimes(2);
      expect(cards.get('wl-a')).toEqual(
        expect.objectContaining({ setsCompleted: 1, onProfile: true }),
      );
      expect(cards.get('wl-b')).toEqual(
        expect.objectContaining({ onProfile: false }),
      );
      expect(cards.get('wl-a')).not.toHaveProperty('notes');
      oneRepMaxModel.findAll.mockReset();
    });

    it('lets only the author share their own finished workout', async () => {
      logModel.findByPk.mockResolvedValueOnce({
        id: 'wl-1',
        userId: 'other',
        status: WorkoutLogStatus.Completed,
      });
      await expect(
        service.assertShareable('wl-1', 'me'),
      ).rejects.toBeInstanceOf(NotFoundException);

      logModel.findByPk.mockResolvedValueOnce({
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.InProgress,
      });
      await expect(
        service.assertShareable('wl-1', 'me'),
      ).rejects.toBeInstanceOf(NotFoundException);

      logModel.findByPk.mockResolvedValueOnce({
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.Completed,
      });
      await expect(
        service.assertShareable('wl-1', 'me'),
      ).resolves.toBeUndefined();
    });

    it('refuses sharing a workout taken down after a report', async () => {
      logModel.findByPk.mockResolvedValueOnce({
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.Completed,
        takenDownAt: new Date('2026-10-28'),
      });
      await expect(service.assertShareable('wl-1', 'me')).rejects.toMatchObject(
        {
          response: { messageKey: 'workout.takenDownNoShare' },
        },
      );
    });

    it('leaves taken-down workouts out of group cards', async () => {
      logModel.findAll.mockResolvedValueOnce([]);
      await service.summariesForPosts(['wl-1']);
      const { where } = logModel.findAll.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(where).toHaveProperty('takenDownAt', null);
    });
  });

  describe('visibility', () => {
    it("starts a freestyle workout at the person's own default", async () => {
      userModel.findByPk.mockResolvedValueOnce({
        id: 'me',
        privacySettings: { workouts: 'COACHES_ONLY' },
      });
      logModel.create.mockResolvedValueOnce({ id: 'wl-new' });

      await service.start('me', { name: 'Solo' });

      expect(logModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'COACHES_ONLY' }),
      );
    });

    it('starts private when the person never chose', async () => {
      userModel.findByPk.mockResolvedValueOnce({
        id: 'me',
        privacySettings: {},
      });
      logModel.create.mockResolvedValueOnce({ id: 'wl-new' });

      await service.start('me', { name: 'Solo' });

      expect(logModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'ONLY_ME' }),
      );
    });

    it('lets only the owner change it', async () => {
      logModel.findByPk.mockResolvedValueOnce({ id: 'wl-1', userId: 'other' });
      await expect(
        service.setVisibility('wl-1', 'me', 'PUBLIC'),
      ).rejects.toBeInstanceOf(NotFoundException);

      const update = jest.fn();
      logModel.findByPk.mockResolvedValueOnce({
        id: 'wl-1',
        userId: 'me',
        visibility: 'ONLY_ME',
        update,
      });
      await expect(
        service.setVisibility('wl-1', 'me', 'COACHES_ONLY'),
      ).resolves.toEqual({ id: 'wl-1', visibility: 'COACHES_ONLY' });
      expect(update).toHaveBeenCalledWith({ visibility: 'COACHES_ONLY' });
    });

    it('keeps a taken-down workout Only me: not Public, not coaches either', async () => {
      const taken = () => ({
        id: 'wl-1',
        userId: 'me',
        visibility: 'ONLY_ME',
        takenDownAt: new Date('2026-10-28'),
        update: jest.fn(),
      });
      for (const level of ['PUBLIC', 'COACHES_ONLY'] as const) {
        logModel.findByPk.mockResolvedValueOnce(taken());
        await expect(
          service.setVisibility('wl-1', 'me', level),
        ).rejects.toMatchObject({
          response: { messageKey: 'workout.takenDownStaysPrivate' },
        });
      }

      logModel.findByPk.mockResolvedValueOnce(taken());
      await expect(
        service.setVisibility('wl-1', 'me', 'ONLY_ME'),
      ).resolves.toEqual({ id: 'wl-1', visibility: 'ONLY_ME' });
    });
  });

  describe('setDuration — the owner corrects how long it took', () => {
    const finished = (over: Record<string, unknown> = {}) => ({
      id: 'wl-1',
      userId: 'me',
      status: WorkoutLogStatus.Completed,
      durationSeconds: 3120,
      update: jest.fn(),
      ...over,
    });

    it('404s on a workout that is not yours, as every owner route does', async () => {
      logModel.findByPk.mockResolvedValueOnce(finished({ userId: 'other' }));
      await expect(
        service.setDuration('wl-1', 'me', 4320),
      ).rejects.toBeInstanceOf(NotFoundException);
      logModel.findByPk.mockResolvedValueOnce(null);
      await expect(
        service.setDuration('wl-1', 'me', 4320),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('stores the corrected length, and only it', async () => {
      const log = finished();
      logModel.findByPk.mockResolvedValueOnce(log);
      await expect(service.setDuration('wl-1', 'me', 4320)).resolves.toEqual({
        id: 'wl-1',
        durationSeconds: 4320,
      });
      // The start, the end and the pauses stay: the day it lands on does
      // not move, and the measured length can still be worked out.
      expect(log.update).toHaveBeenCalledWith({ durationSeconds: 4320 });
    });

    it('corrects an unknown (over six hours) duration into a real one', async () => {
      const log = finished({ durationSeconds: null });
      logModel.findByPk.mockResolvedValueOnce(log);
      await service.setDuration('wl-1', 'me', 5400);
      expect(log.update).toHaveBeenCalledWith({ durationSeconds: 5400 });
    });

    it('writes nothing when the length is already that', async () => {
      const log = finished();
      logModel.findByPk.mockResolvedValueOnce(log);
      await service.setDuration('wl-1', 'me', 3120);
      expect(log.update).not.toHaveBeenCalled();
    });

    it('refuses a workout that is not finished', async () => {
      for (const status of [
        WorkoutLogStatus.InProgress,
        WorkoutLogStatus.Skipped,
      ]) {
        const log = finished({ status });
        logModel.findByPk.mockResolvedValueOnce(log);
        await expect(
          service.setDuration('wl-1', 'me', 4320),
        ).rejects.toMatchObject({
          response: { messageKey: 'workout.durationNotFinished' },
        });
        expect(log.update).not.toHaveBeenCalled();
      }
    });

    it('keeps to a minute through six hours, the line the measured clock uses', async () => {
      for (const seconds of [0, 59, 21_601, 90.5]) {
        logModel.findByPk.mockResolvedValueOnce(finished());
        await expect(
          service.setDuration('wl-1', 'me', seconds),
        ).rejects.toMatchObject({
          response: { messageKey: 'workout.durationOutOfRange' },
        });
      }
      for (const seconds of [60, 21_600]) {
        logModel.findByPk.mockResolvedValueOnce(finished());
        await expect(
          service.setDuration('wl-1', 'me', seconds),
        ).resolves.toEqual({ id: 'wl-1', durationSeconds: seconds });
      }
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

      // The apps learn whether there is a photo, never where it is stored.
      expect(out).toEqual({ ...plainProjection, hasPhoto: false });
      expect(out).not.toHaveProperty('photoPublicId');
      // The owner's summary, coach line included, is never the coach's.
      expect(out).not.toHaveProperty('summary');
      expect(instructorProfileModel.findOne).not.toHaveBeenCalled();
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

  // ─── Workouts round 2 ────────────────────────────────────────────

  describe('remove — deleting a finished workout', () => {
    const finished = (fields: Record<string, unknown> = {}) => ({
      id: 'wl-1',
      userId: 'me',
      status: WorkoutLogStatus.Completed,
      assignedWorkoutId: 'aw-1',
      programAssignmentId: 'pa-1',
      sourceProgramId: null,
      photoPublicId: 'workout-photos/me/wl-1',
      destroy: jest.fn().mockResolvedValue(undefined),
      ...fields,
    });

    it('deletes it in one transaction and opens its plan day and plan again', async () => {
      const log = finished();
      logModel.findByPk.mockResolvedValueOnce(log);
      // 4 days in the plan, 2 still done once this one is open again.
      assignedWorkoutModel.count
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(2);

      await service.remove('wl-1', 'me');

      expect(sequelize.transaction).toHaveBeenCalledTimes(1);
      expect(assignedWorkoutModel.update).toHaveBeenCalledWith(
        { status: null },
        { where: { id: 'aw-1' }, transaction: fakeTx },
      );
      // Sets, exercises, reports and its records go with it by cascade.
      expect(log.destroy).toHaveBeenCalledWith({ transaction: fakeTx });
      expect(assignmentModel.update).toHaveBeenCalledWith(
        { status: 'ACTIVE' },
        {
          where: { id: 'pa-1', status: 'COMPLETED' },
          transaction: fakeTx,
        },
      );
      expect(sequelize.query).toHaveBeenCalledWith(
        expect.stringContaining('completion_percent'),
        expect.objectContaining({
          replacements: { p: 50, id: 'pa-1' },
          transaction: fakeTx,
        }),
      );
    });

    it('deletes the photo after commit, and a failure there fails nothing', async () => {
      logModel.findByPk.mockResolvedValueOnce(
        finished({ assignedWorkoutId: null, programAssignmentId: null }),
      );
      storage.deletePrivateImage.mockRejectedValueOnce(new Error('down'));

      await expect(service.remove('wl-1', 'me')).resolves.toBeUndefined();

      expect(storage.deletePrivateImage).toHaveBeenCalledWith(
        'workout-photos/me/wl-1',
      );
    });

    it("works the routine's last done out again", async () => {
      const previous = new Date('2026-10-01T10:00:00Z');
      logModel.findByPk.mockResolvedValueOnce(
        finished({
          assignedWorkoutId: null,
          programAssignmentId: null,
          sourceProgramId: 'prog-1',
          photoPublicId: null,
        }),
      );
      programModel.findByPk.mockResolvedValueOnce({
        id: 'prog-1',
        source: 'USER',
      });
      logModel.findOne.mockResolvedValueOnce({ startedAt: previous });

      await service.remove('wl-1', 'me');

      expect(programModel.update).toHaveBeenCalledWith(
        { lastPerformedAt: previous },
        { where: { id: 'prog-1' } },
      );
      expect(storage.deletePrivateImage).not.toHaveBeenCalled();
    });

    it('deletes an abandoned one the same way, leaving any plan alone when no day was filled', async () => {
      const log = finished({
        status: WorkoutLogStatus.Abandoned,
        assignedWorkoutId: null,
        photoPublicId: null,
      });
      logModel.findByPk.mockResolvedValueOnce(log);
      assignedWorkoutModel.count.mockResolvedValue(0);

      await service.remove('wl-1', 'me');

      expect(log.destroy).toHaveBeenCalled();
      expect(assignedWorkoutModel.update).not.toHaveBeenCalled();
      expect(assignmentModel.update).not.toHaveBeenCalled();
      assignedWorkoutModel.count.mockReset();
    });

    it('404s on a workout that is not yours, and deletes nothing', async () => {
      const log = finished({ userId: 'someone-else' });
      logModel.findByPk.mockResolvedValueOnce(log);

      await expect(service.remove('wl-1', 'me')).rejects.toThrow(
        NotFoundException,
      );
      expect(log.destroy).not.toHaveBeenCalled();
    });
  });

  describe('complete — records carry their workout', () => {
    it('links each estimated record to the workout, so deleting it deletes them', async () => {
      const log = {
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.InProgress,
        startedAt: new Date(Date.now() - 3_600_000),
        pausedSeconds: 0,
        pausedAt: null,
        programAssignmentId: null,
        assignedWorkoutId: null,
        update: jest.fn().mockResolvedValue(undefined),
        get() {
          return this;
        },
      };
      logModel.findByPk.mockResolvedValueOnce(log);
      loggedSetModel.findOne.mockResolvedValueOnce(null); // no ticked time
      loggedExerciseModel.findAll.mockResolvedValueOnce([
        {
          exerciseId: 'bench',
          sets: [{ isCompleted: true, reps: 5, weightKg: 80 }],
        },
      ]);
      oneRepMaxModel.findAll.mockResolvedValueOnce([]);

      await service.complete('wl-1', {}, 'me');

      expect(oneRepMaxModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          exerciseId: 'bench',
          source: 'ESTIMATED_EPLEY',
          workoutLogId: 'wl-1',
        }),
        { transaction: fakeTx },
      );
    });
  });

  describe('logSet — the rest actually taken', () => {
    const live = { id: 'wl-1', userId: 'me', status: 'IN_PROGRESS' };
    const setRow = () => ({
      id: 'ls-1',
      exercise: { workoutLogId: 'wl-1' },
      update: jest.fn().mockResolvedValue(undefined),
    });

    it('stores the rest with how it was measured', async () => {
      const set = setRow();
      logModel.findByPk.mockResolvedValueOnce(live);
      loggedSetModel.findByPk.mockResolvedValueOnce(set);

      await service.logSet(
        'wl-1',
        'ls-1',
        { restAfterSeconds: 150, restSource: RestSource.Tap },
        'me',
      );

      expect(set.update).toHaveBeenCalledWith({
        restAfterSeconds: 150,
        restSource: 'TAP',
      });
    });

    it('stores no rest for a break, whatever time is sent', async () => {
      const set = setRow();
      logModel.findByPk.mockResolvedValueOnce(live);
      loggedSetModel.findByPk.mockResolvedValueOnce(set);

      await service.logSet(
        'wl-1',
        'ls-1',
        { restAfterSeconds: 1500, restSource: RestSource.Break },
        'me',
      );

      expect(set.update).toHaveBeenCalledWith({
        restAfterSeconds: null,
        restSource: 'BREAK',
      });
    });

    it('stamps a tick at the moment it was tapped, held inside the workout', async () => {
      const startedAt = new Date(Date.now() - 30 * 60_000);
      const tapped = new Date(Date.now() - 5 * 60_000);
      const cases: Array<[string, number]> = [
        [tapped.toISOString(), tapped.getTime()],
        ['2020-01-01T00:00:00.000Z', startedAt.getTime()],
      ];
      for (const [sent, expected] of cases) {
        const set = setRow();
        logModel.findByPk.mockResolvedValueOnce({ ...live, startedAt });
        loggedSetModel.findByPk.mockResolvedValueOnce(set);

        await service.logSet(
          'wl-1',
          'ls-1',
          { isCompleted: true, reps: 8, completedAt: sent },
          'me',
        );

        expect(set.update).toHaveBeenCalledWith({
          reps: 8,
          isCompleted: true,
          completedAt: new Date(expected),
        });
      }
    });

    it('stamps a tick now when no time is sent, and never one in the future', async () => {
      const startedAt = new Date(Date.now() - 30 * 60_000);
      for (const sent of [undefined, '2099-01-01T00:00:00.000Z']) {
        const set = setRow();
        logModel.findByPk.mockResolvedValueOnce({ ...live, startedAt });
        loggedSetModel.findByPk.mockResolvedValueOnce(set);
        const before = Date.now();

        await service.logSet(
          'wl-1',
          'ls-1',
          { isCompleted: true, completedAt: sent },
          'me',
        );

        const args = set.update.mock.calls[0][0] as { completedAt: Date };
        expect(args.completedAt.getTime()).toBeGreaterThanOrEqual(before);
        expect(args.completedAt.getTime()).toBeLessThanOrEqual(Date.now());
      }
    });

    it('clears the source when sent null', async () => {
      const set = setRow();
      logModel.findByPk.mockResolvedValueOnce(live);
      loggedSetModel.findByPk.mockResolvedValueOnce(set);

      await service.logSet('wl-1', 'ls-1', { restSource: null }, 'me');

      expect(set.update).toHaveBeenCalledWith({ restSource: null });
    });
  });

  describe('pauseGap — pausing for time already spent away', () => {
    const running = (fields: Record<string, unknown> = {}) => ({
      id: 'wl-1',
      userId: 'me',
      status: WorkoutLogStatus.InProgress,
      startedAt: new Date(Date.now() - 3_600_000), // an hour ago
      pausedAt: null,
      pausedSeconds: 300,
      update: jest.fn().mockResolvedValue(undefined),
      ...fields,
    });

    it('adds the time away to the paused time', async () => {
      const log = running();
      logModel.findByPk.mockResolvedValueOnce(log);

      await service.pauseGap('wl-1', 'me', 1_500);

      expect(log.update).toHaveBeenCalledWith({ pausedSeconds: 1_800 });
    });

    it('refuses more than the workout has been running', async () => {
      // 60 min since the start, 5 paused: 55 min of active time.
      const log = running();
      logModel.findByPk.mockResolvedValueOnce(log);

      const err = await service
        .pauseGap('wl-1', 'me', 56 * 60)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(BadRequestException);
      expect((err as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({ messageKey: 'workout.pauseGapTooLong' }),
      );
      expect(log.update).not.toHaveBeenCalled();
    });

    it('measures a paused workout up to the start of its pause', async () => {
      // Paused 40 minutes in: 35 min active, whatever the clock says now.
      const log = running({
        pausedAt: new Date(Date.now() - 20 * 60_000),
      });
      logModel.findByPk.mockResolvedValueOnce(log);

      await expect(service.pauseGap('wl-1', 'me', 36 * 60)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('refuses a workout that is over', async () => {
      logModel.findByPk.mockResolvedValueOnce(
        running({ status: WorkoutLogStatus.Completed }),
      );
      await expect(service.pauseGap('wl-1', 'me', 600)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('supersets in a running workout', () => {
    const live = { id: 'wl-1', userId: 'me', status: 'IN_PROGRESS' };

    it('unlinks the exercise left alone when one of a pair is removed', async () => {
      const ex = {
        id: 'le-a1',
        workoutLogId: 'wl-1',
        supersetGroupId: 1,
        destroy: jest.fn().mockResolvedValue(undefined),
      };
      logModel.findByPk.mockResolvedValueOnce(live);
      loggedExerciseModel.findByPk.mockResolvedValueOnce(ex);
      loggedExerciseModel.findAll.mockResolvedValueOnce([{ id: 'le-a2' }]);

      await service.removeExerciseFromLog('wl-1', 'le-a1', 'me');

      expect(ex.destroy).toHaveBeenCalledWith({ transaction: fakeTx });
      expect(loggedExerciseModel.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workoutLogId: 'wl-1', supersetGroupId: 1 },
          transaction: fakeTx,
        }),
      );
      expect(loggedExerciseModel.update).toHaveBeenCalledWith(
        { supersetGroupId: null },
        { where: { id: 'le-a2' }, transaction: fakeTx },
      );
    });

    it('keeps a superset of three linked when one leaves', async () => {
      logModel.findByPk.mockResolvedValueOnce(live);
      loggedExerciseModel.findByPk.mockResolvedValueOnce({
        id: 'le-a1',
        workoutLogId: 'wl-1',
        supersetGroupId: 1,
        destroy: jest.fn().mockResolvedValue(undefined),
      });
      loggedExerciseModel.findAll.mockResolvedValueOnce([
        { id: 'le-a2' },
        { id: 'le-a3' },
      ]);

      await service.removeExerciseFromLog('wl-1', 'le-a1', 'me');

      expect(loggedExerciseModel.update).not.toHaveBeenCalled();
    });

    it('keeps the link when an exercise is swapped', async () => {
      const ex = {
        id: 'le-a1',
        workoutLogId: 'wl-1',
        exerciseId: 'bench',
        swappedFromExerciseId: null,
        supersetGroupId: 1,
        update: jest.fn().mockResolvedValue(undefined),
      };
      logModel.findByPk.mockResolvedValueOnce(live);
      loggedExerciseModel.findByPk.mockResolvedValueOnce(ex);
      exerciseModel.findByPk.mockResolvedValueOnce({
        id: 'db-press',
        name: 'Dumbbell press',
        thumbnailUrl: null,
        visibility: 'PUBLIC',
        ownerId: null,
      });

      await service.swapLoggedExercise('wl-1', 'le-a1', 'me', 'db-press');

      const [fields] = ex.update.mock.calls[0] as [Record<string, unknown>];
      expect(fields).not.toHaveProperty('supersetGroupId');
    });
  });

  describe('findById — plan notes, planned rest and the private note', () => {
    function logWith(
      exercises: Record<string, unknown>[],
      fields: Record<string, unknown> = {},
    ) {
      const plain = {
        id: 'wl-1',
        userId: 'me',
        sourceProgram: null,
        exercises,
        ...fields,
      };
      return {
        id: 'wl-1',
        userId: 'me',
        status: WorkoutLogStatus.InProgress,
        startedAt: new Date(),
        completedAt: null,
        get: () => plain,
      };
    }

    type Out = {
      exercises: {
        personalNote?: string | null;
        sets: { plannedRestSeconds?: number | null }[];
      }[];
    };

    it("reads a coach plan's rest from the assigned set", async () => {
      logModel.findByPk.mockResolvedValueOnce(
        logWith([
          {
            exerciseId: 'bench',
            assignedExercise: { id: 'ae-1', notes: 'Slow down' },
            prescribedExercise: null,
            sets: [
              { assignedSet: { restAfterSeconds: 120 }, prescribedSet: null },
              { assignedSet: { restAfterSeconds: null }, prescribedSet: null },
            ],
          },
        ]),
      );

      const out = (await service.findById('wl-1', 'me')) as unknown as Out;

      expect(out.exercises[0].sets.map((s) => s.plannedRestSeconds)).toEqual([
        120,
        null,
      ]);
      expect(programWorkoutModel.findAll).not.toHaveBeenCalled();
    });

    it("falls back from a routine's set to its day, then its default", async () => {
      logModel.findByPk.mockResolvedValueOnce(
        logWith(
          [
            {
              exerciseId: 'bench',
              prescribedExercise: { id: 'pe-1', programWorkoutId: 'pw-1' },
              sets: [
                { assignedSet: null, prescribedSet: { restAfterSeconds: 90 } },
                {
                  assignedSet: null,
                  prescribedSet: { restAfterSeconds: null },
                },
              ],
            },
            {
              // Added during the workout: no plan row, the routine's default.
              exerciseId: 'curl',
              prescribedExercise: null,
              sets: [{ assignedSet: null, prescribedSet: null }],
            },
          ],
          { sourceProgram: { id: 'r-1', defaultRestSeconds: 75 } },
        ),
      );
      programWorkoutModel.findAll.mockResolvedValueOnce([
        { id: 'pw-1', defaultRestSeconds: 150 },
      ]);

      const out = (await service.findById('wl-1', 'me')) as unknown as Out;

      expect(out.exercises[0].sets.map((s) => s.plannedRestSeconds)).toEqual([
        90, 150,
      ]);
      expect(out.exercises[1].sets[0].plannedRestSeconds).toBe(75);
      // One query for every day, however many exercises.
      expect(programWorkoutModel.findAll).toHaveBeenCalledTimes(1);
    });

    it('adds the private note on the owner read, in one query', async () => {
      logModel.findByPk.mockResolvedValueOnce(
        logWith([
          { exerciseId: 'bench', sets: [] },
          { exerciseId: 'curl', sets: [] },
          { exerciseId: null, sets: [] },
        ]),
      );
      exerciseNotes.notesFor.mockResolvedValueOnce(
        new Map([['bench', 'Seat on 4']]),
      );

      const out = (await service.findById('wl-1', 'me', 'en', {
        personalNotes: true,
      })) as unknown as Out;

      expect(exerciseNotes.notesFor).toHaveBeenCalledTimes(1);
      expect(exerciseNotes.notesFor).toHaveBeenCalledWith('me', [
        'bench',
        'curl',
      ]);
      expect(out.exercises.map((e) => e.personalNote)).toEqual([
        'Seat on 4',
        null,
        null,
      ]);
    });

    it('never carries the private note unless the owner route asks', async () => {
      logModel.findByPk.mockResolvedValueOnce(
        logWith([{ exerciseId: 'bench', sets: [] }]),
      );

      const out = (await service.findById('wl-1', 'me')) as unknown as Out;

      expect(exerciseNotes.notesFor).not.toHaveBeenCalled();
      expect(out.exercises[0]).not.toHaveProperty('personalNote');
    });

    it("never gives a coach the client's private note", async () => {
      logModel.findByPk.mockResolvedValueOnce({
        userId: 'client-1',
        programAssignmentId: 'asg-1',
      });
      instructorClientModel.findOne.mockResolvedValueOnce({ id: 'link-1' });
      assignmentModel.findAll.mockResolvedValueOnce([{ id: 'asg-1' }]);
      logModel.findByPk.mockResolvedValueOnce({
        ...logWith([{ exerciseId: 'bench', sets: [] }]),
        userId: 'client-1',
      });

      const out = (await service.findByIdForInstructor(
        'wl-1',
        'coach-1',
      )) as unknown as Out;

      expect(exerciseNotes.notesFor).not.toHaveBeenCalled();
      expect(out.exercises[0]).not.toHaveProperty('personalNote');
    });

    it('loads the plan notes and both kinds of plan set', async () => {
      logModel.findByPk.mockResolvedValueOnce(logWith([]));

      await service.findById('wl-1', 'me');

      const [, options] = logModel.findByPk.mock.calls[0] as [
        string,
        {
          include: {
            as: string;
            include?: { as: string; include?: { as: string }[] }[];
          }[];
        },
      ];
      const exercises = options.include.find((i) => i.as === 'exercises')!;
      const names = exercises.include!.map((i) => i.as);
      expect(names).toEqual(
        expect.arrayContaining(['assignedExercise', 'prescribedExercise']),
      );
      const sets = exercises.include!.find((i) => i.as === 'sets')!;
      expect(sets.include!.map((i) => i.as)).toEqual([
        'assignedSet',
        'prescribedSet',
      ]);
    });
  });

  describe('saveLogAsRoutine — the planned rest, not the rest taken', () => {
    it("keeps the plan's rest and the routine's default, not what was rested", async () => {
      logModel.findByPk.mockResolvedValueOnce({
        id: 'log-1',
        userId: 'me',
        sourceProgramId: 'r-1',
      });
      programModel.findByPk.mockResolvedValueOnce({
        id: 'r-1',
        defaultRestSeconds: 90,
        workouts: [{ id: 'pw-1', defaultRestSeconds: null, sequenceNumber: 0 }],
      });
      programModel.create.mockResolvedValueOnce({ id: 'p-new' });
      programWorkoutModel.create.mockResolvedValueOnce({ id: 'pw-new' });
      prescribedExerciseModel.create.mockResolvedValueOnce({ id: 'pe-new' });
      loggedExerciseModel.findAll.mockResolvedValueOnce([
        {
          exerciseId: 'ex-1',
          supersetGroupId: null,
          notes: null,
          sets: [
            {
              setType: 'NORMAL',
              reps: 8,
              weightKg: 60,
              // Rested 3:10, the plan said 2:00.
              restAfterSeconds: 190,
              restSource: 'TAP',
              prescribedSet: { restAfterSeconds: 120 },
            },
            {
              setType: 'NORMAL',
              reps: 8,
              weightKg: 60,
              restAfterSeconds: 75,
              restSource: 'ESTIMATED',
              prescribedSet: null,
            },
          ],
        },
      ]);

      await service.saveLogAsRoutine('log-1', 'me', { name: 'Push day B' });

      expect(programModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ defaultRestSeconds: 90 }),
        expect.anything(),
      );
      const [rows] = prescribedSetModel.bulkCreate.mock.calls[0] as [
        Array<Record<string, unknown>>,
      ];
      expect(rows.map((r) => r.restAfterSeconds)).toEqual([120, null]);
    });
  });
});
