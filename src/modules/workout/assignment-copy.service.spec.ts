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

import { InstructorClient } from '../client/entities/instructor-client.entity';
import { Exercise } from '../exercise/entities/exercise.entity';
import {
  NotificationService,
  NotificationType,
} from '../notification/notification.service';
import { User } from '../user/entities/user.entity';
import { AssignmentCopyService } from './assignment-copy.service';
import { CoachAccessService } from './coach-access.service';
import { AssignedExercise } from './entities/assigned-exercise.entity';
import { AssignedSet } from './entities/assigned-set.entity';
import { AssignedWorkout } from './entities/assigned-workout.entity';
import { PrescribedExercise } from './entities/prescribed-exercise.entity';
import { ProgramAssignment } from './entities/program-assignment.entity';
import { WorkoutLog } from './entities/workout-log.entity';
import {
  ExerciseSetType,
  ProgramAssignmentStatus,
  WorkoutLogStatus,
} from './entities/workout.enums';
import {
  fakeTx,
  makeSilentLogger,
} from '../../../test/helpers/sequelize-mocks';

/**
 * A coach edits one client's copy of a plan (owner, 2026-11-20): only the
 * plan's coach, only upcoming days not started, each write marks what
 * changed, "Back to the program's values" follows the program as it is
 * now, a day moves only to a free date inside the plan, and Done tells the
 * client once.
 */
describe('AssignmentCopyService — a coach edits one client copy', () => {
  let service: AssignmentCopyService;
  const coach = 'coach-1';
  const today = '2026-11-20';
  let events: string[];

  const assignmentModel = { findByPk: jest.fn() };
  const assignedWorkoutModel = { findOne: jest.fn(), findAll: jest.fn() };
  const assignedExerciseModel = {
    findOne: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    max: jest.fn(),
  };
  const assignedSetModel = {
    findAll: jest.fn(),
    create: jest.fn(),
    destroy: jest.fn(),
    bulkCreate: jest.fn(),
  };
  const prescribedExerciseModel = { findAll: jest.fn() };
  const exerciseModel = { findAll: jest.fn() };
  const logModel = { findOne: jest.fn(), findAll: jest.fn() };
  const instructorClientModel = { findOne: jest.fn() };
  const userModel = { findByPk: jest.fn() };
  const coachAccess = { visibleAssignmentIds: jest.fn() };
  const sequelize = { transaction: jest.fn(), query: jest.fn() };
  const notificationService = { notify: jest.fn() };

  /** A model row with `update` merging the changes in. */
  function rowOf<T extends object>(fields: T) {
    const row = {
      ...fields,
      update: jest.fn((changes: Record<string, unknown>) => {
        Object.assign(row, changes);
        return Promise.resolve();
      }),
      destroy: jest.fn(() => Promise.resolve()),
    };
    return row;
  }

  function plan(overrides: Record<string, unknown> = {}) {
    return rowOf({
      id: 'a-1',
      instructorId: coach,
      clientId: 'client-1',
      programNameSnapshot: 'Strength Base',
      masterProgramId: 'p-1',
      status: ProgramAssignmentStatus.Active,
      startDate: '2026-11-02',
      endDate: '2026-12-25',
      completionPercent: 25,
      coachChangesNotifiedAt: null as Date | null,
      ...overrides,
    });
  }

  function dayRow(overrides: Record<string, unknown> = {}) {
    return rowOf({
      id: 'd-1',
      programAssignmentId: 'a-1',
      name: 'Push A',
      notes: null,
      weekIndex: 2,
      dayIndex: 0,
      scheduledDate: '2026-11-23',
      status: null as WorkoutLogStatus | null,
      coachChangedAt: null as Date | null,
      ...overrides,
    });
  }

  function exerciseRow(overrides: Record<string, unknown> = {}) {
    return rowOf({
      id: 'ae-1',
      assignedWorkoutId: 'd-1',
      exerciseId: 'bench',
      masterExerciseId: 'pe-1' as string | null,
      supersetGroupId: null as number | null,
      orderIndex: 0,
      notes: null as string | null,
      isModifiedFromMaster: false,
      ...overrides,
    });
  }

  function setRow(overrides: Record<string, unknown> = {}) {
    return rowOf({
      id: 's-1',
      assignedExerciseId: 'ae-1',
      masterSetId: 'ps-1' as string | null,
      orderIndex: 0,
      setType: ExerciseSetType.Normal,
      targetRepsMin: 8,
      targetRepsMax: 10,
      targetWeightKg: 60,
      targetWeightPercent1rm: null,
      targetDurationSeconds: null,
      targetDistanceMeters: null,
      targetRpe: null,
      targetRir: null,
      restAfterSeconds: 120,
      tempo: null,
      notes: null,
      ...overrides,
    });
  }

  /** The program row an exercise links to, as the program is now. */
  function programRow(overrides: Record<string, unknown> = {}) {
    return {
      id: 'pe-1',
      exerciseId: 'bench',
      notes: 'Pause on the chest.',
      translations: null,
      exercise: { id: 'bench', name: 'Bench press' },
      sets: [
        {
          id: 'ps-2',
          orderIndex: 1,
          setType: ExerciseSetType.Normal,
          targetRepsMin: 8,
          targetRepsMax: 10,
          targetWeightKg: 62.5,
          targetWeightPercent1rm: null,
          targetDurationSeconds: null,
          targetDistanceMeters: null,
          targetRpe: null,
          targetRir: null,
          restAfterSeconds: null,
          tempo: null,
          notes: null,
        },
        {
          id: 'ps-1',
          orderIndex: 0,
          setType: ExerciseSetType.Normal,
          targetRepsMin: 8,
          targetRepsMax: 10,
          targetWeightKg: 62.5,
          targetWeightPercent1rm: null,
          targetDurationSeconds: null,
          targetDistanceMeters: null,
          targetRpe: null,
          targetRir: null,
          restAfterSeconds: null,
          tempo: null,
          notes: null,
        },
      ],
      workout: {
        id: 'pw-1',
        defaultRestSeconds: 90,
        program: { id: 'p-1', defaultRestSeconds: 60 },
      },
      ...overrides,
    };
  }

  /** The caller is the plan's coach, still coaching; the day is open. */
  function given(
    assignment: ReturnType<typeof plan>,
    day: ReturnType<typeof dayRow>,
    hasLog = false,
  ) {
    assignmentModel.findByPk.mockResolvedValue(assignment);
    instructorClientModel.findOne.mockResolvedValue({ id: 'rel-1' });
    assignedWorkoutModel.findOne.mockResolvedValue(day);
    logModel.findOne.mockResolvedValue(hasLog ? { id: 'log-1' } : null);
    userModel.findByPk.mockResolvedValue({
      id: 'client-1',
      firstName: 'Andrei',
      lastName: 'Pop',
      language: 'ro',
    });
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    events = [];
    sequelize.transaction.mockImplementation(
      async (cb: (tx: unknown) => unknown) => {
        const out = await cb(fakeTx);
        events.push('commit');
        return out;
      },
    );
    notificationService.notify.mockImplementation(() => {
      events.push('notify');
      return Promise.resolve();
    });
    assignedSetModel.destroy.mockResolvedValue(1);
    assignedSetModel.create.mockResolvedValue({});
    assignedExerciseModel.update.mockResolvedValue([1]);

    const module = await Test.createTestingModule({
      providers: [
        AssignmentCopyService,
        {
          provide: getModelToken(ProgramAssignment),
          useValue: assignmentModel,
        },
        {
          provide: getModelToken(AssignedWorkout),
          useValue: assignedWorkoutModel,
        },
        {
          provide: getModelToken(AssignedExercise),
          useValue: assignedExerciseModel,
        },
        { provide: getModelToken(AssignedSet), useValue: assignedSetModel },
        {
          provide: getModelToken(PrescribedExercise),
          useValue: prescribedExerciseModel,
        },
        { provide: getModelToken(Exercise), useValue: exerciseModel },
        { provide: getModelToken(WorkoutLog), useValue: logModel },
        {
          provide: getModelToken(InstructorClient),
          useValue: instructorClientModel,
        },
        { provide: getModelToken(User), useValue: userModel },
        { provide: CoachAccessService, useValue: coachAccess },
        { provide: Sequelize, useValue: sequelize },
        { provide: NotificationService, useValue: notificationService },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();
    service = module.get(AssignmentCopyService);
  });

  describe('who may edit', () => {
    it("hides another coach's plan (404)", async () => {
      given(plan({ instructorId: 'coach-2' }), dayRow());
      await expect(
        service.moveDay('a-1', 'd-1', { date: '2026-11-26' }, coach, today),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(sequelize.transaction).not.toHaveBeenCalled();
    });

    it('hides the plan once the coaching has ended (404)', async () => {
      given(plan(), dayRow());
      instructorClientModel.findOne.mockResolvedValue(null);
      await expect(
        service.overview('a-1', coach, today),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('hides a self-scheduled plan, which has no coach (404)', async () => {
      given(plan({ instructorId: null }), dayRow());
      await expect(service.finishEditing('a-1', coach)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('asks for the ACTIVE relationship with this client', async () => {
      given(plan(), dayRow());
      assignedWorkoutModel.findAll.mockResolvedValue([]);
      await service.overview('a-1', coach, today);
      expect(instructorClientModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            instructorId: coach,
            clientId: 'client-1',
            status: 'ACTIVE',
          }),
        }),
      );
    });
  });

  describe('which days can change (checked inside the transaction)', () => {
    async function editNote() {
      return service.updateExercise(
        'a-1',
        'd-1',
        'ae-1',
        { notes: 'Slower down.' },
        coach,
        today,
      );
    }

    it('refuses a day whose date has passed', async () => {
      given(plan(), dayRow({ scheduledDate: '2026-11-19' }));
      await expect(editNote()).rejects.toMatchObject({
        response: { messageKey: 'workout.copyDayPast' },
      });
    });

    it('refuses a started day, by its status or by its log', async () => {
      given(plan(), dayRow({ status: WorkoutLogStatus.InProgress }));
      await expect(editNote()).rejects.toMatchObject({
        response: { messageKey: 'workout.copyDayStarted' },
      });
      given(plan(), dayRow(), true);
      await expect(editNote()).rejects.toMatchObject({
        response: { messageKey: 'workout.copyDayStarted' },
      });
    });

    it('refuses a finished day', async () => {
      given(plan(), dayRow({ status: WorkoutLogStatus.Completed }));
      await expect(editNote()).rejects.toMatchObject({
        response: { messageKey: 'workout.copyDayDone' },
      });
    });

    it('refuses every day of a cancelled plan', async () => {
      given(plan({ status: ProgramAssignmentStatus.Cancelled }), dayRow());
      await expect(editNote()).rejects.toBeInstanceOf(ConflictException);
      await expect(editNote()).rejects.toMatchObject({
        response: { messageKey: 'workout.copyPlanClosed' },
      });
    });

    it('edits an upcoming day of a paused plan, marking the exercise and dating the day', async () => {
      const day = dayRow();
      const row = exerciseRow();
      given(plan({ status: ProgramAssignmentStatus.Paused }), day);
      assignedExerciseModel.findOne.mockResolvedValue(row);

      await editNote();

      expect(row.update).toHaveBeenCalledWith(
        { notes: 'Slower down.', isModifiedFromMaster: true },
        { transaction: fakeTx },
      );
      expect(day.update).toHaveBeenCalledWith(
        { coachChangedAt: expect.any(Date) },
        { transaction: fakeTx },
      );
    });
  });

  describe('sets', () => {
    it('updates a set in place and marks the exercise changed', async () => {
      const day = dayRow();
      const row = exerciseRow();
      const saved = setRow();
      given(plan(), day);
      assignedExerciseModel.findOne.mockResolvedValue(row);
      assignedSetModel.findAll.mockResolvedValue([saved]);

      await service.setSets(
        'a-1',
        'd-1',
        'ae-1',
        {
          sets: [
            {
              id: 's-1',
              setType: ExerciseSetType.Normal,
              targetRepsMin: 8,
              targetRepsMax: 8,
              targetWeightKg: 57.5,
              restAfterSeconds: 120,
            },
          ],
        },
        coach,
        today,
      );

      expect(saved.update).toHaveBeenCalledWith(
        expect.objectContaining({ targetRepsMax: 8, targetWeightKg: 57.5 }),
        { transaction: fakeTx },
      );
      expect(assignedSetModel.create).not.toHaveBeenCalled();
      expect(row.update).toHaveBeenCalledWith(
        { isModifiedFromMaster: true },
        { transaction: fakeTx },
      );
      expect(day.update).toHaveBeenCalled();
    });

    it('marks nothing when the sets come back as they were', async () => {
      const day = dayRow();
      const row = exerciseRow();
      const saved = setRow();
      given(plan(), day);
      assignedExerciseModel.findOne.mockResolvedValue(row);
      assignedSetModel.findAll.mockResolvedValue([saved]);

      await service.setSets(
        'a-1',
        'd-1',
        'ae-1',
        {
          sets: [
            {
              id: 's-1',
              setType: ExerciseSetType.Normal,
              targetRepsMin: 8,
              targetRepsMax: 10,
              targetWeightKg: 60,
              restAfterSeconds: 120,
            },
          ],
        },
        coach,
        today,
      );

      expect(saved.update).not.toHaveBeenCalled();
      expect(row.update).not.toHaveBeenCalled();
      expect(day.update).not.toHaveBeenCalled();
    });

    it("refuses a set id that is not this exercise's (404)", async () => {
      given(plan(), dayRow());
      assignedExerciseModel.findOne.mockResolvedValue(exerciseRow());
      assignedSetModel.findAll.mockResolvedValue([setRow()]);
      await expect(
        service.setSets(
          'a-1',
          'd-1',
          'ae-1',
          { sets: [{ id: 's-other' }] },
          coach,
          today,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("back to the program's values", () => {
    it('restores the movement, note and sets from the program as it is now', async () => {
      const day = dayRow();
      const row = exerciseRow({
        exerciseId: 'db-press',
        isModifiedFromMaster: true,
      });
      const linked = setRow({
        id: 's-1',
        masterSetId: 'ps-1',
        targetWeightKg: 57.5,
      });
      const addedHere = setRow({ id: 's-9', masterSetId: null });
      given(plan(), day);
      assignedExerciseModel.findOne.mockResolvedValue(row);
      prescribedExerciseModel.findAll.mockResolvedValue([programRow()]);
      assignedSetModel.findAll.mockResolvedValue([linked, addedHere]);

      await service.revert('a-1', 'd-1', 'ae-1', coach, today);

      expect(row.update).toHaveBeenCalledWith(
        {
          exerciseId: 'bench',
          notes: 'Pause on the chest.',
          isModifiedFromMaster: false,
        },
        { transaction: fakeTx },
      );
      // The set the coach added goes; the linked one takes the program's
      // targets, with the day's rest for a set that has none.
      expect(assignedSetModel.destroy).toHaveBeenCalledWith({
        where: { id: ['s-9'] },
        transaction: fakeTx,
      });
      expect(linked.update).toHaveBeenCalledWith(
        expect.objectContaining({
          orderIndex: 0,
          targetWeightKg: 62.5,
          restAfterSeconds: 90,
        }),
        { transaction: fakeTx },
      );
      // The program set with no copy is created, linked to it.
      expect(assignedSetModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          assignedExerciseId: 'ae-1',
          masterSetId: 'ps-2',
          orderIndex: 1,
        }),
        { transaction: fakeTx },
      );
      expect(day.update).toHaveBeenCalled();
    });

    it('refuses an exercise the coach added (no program row)', async () => {
      given(plan(), dayRow());
      assignedExerciseModel.findOne.mockResolvedValue(
        exerciseRow({ masterExerciseId: null, isModifiedFromMaster: true }),
      );
      await expect(
        service.revert('a-1', 'd-1', 'ae-1', coach, today),
      ).rejects.toMatchObject({
        response: { messageKey: 'workout.copyCannotRevert' },
      });
    });

    it('refuses when its program row is gone', async () => {
      given(plan(), dayRow());
      assignedExerciseModel.findOne.mockResolvedValue(
        exerciseRow({ isModifiedFromMaster: true }),
      );
      prescribedExerciseModel.findAll.mockResolvedValue([]);
      await expect(
        service.revert('a-1', 'd-1', 'ae-1', coach, today),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('moving a day', () => {
    it('moves to a free date inside the plan, its slot following', async () => {
      const day = dayRow();
      given(plan(), day);
      assignedWorkoutModel.findOne
        .mockResolvedValueOnce(day)
        .mockResolvedValueOnce(null);

      await service.moveDay('a-1', 'd-1', { date: '2026-11-26' }, coach, today);

      expect(day.update).toHaveBeenCalledWith(
        { scheduledDate: '2026-11-26', weekIndex: 2, dayIndex: 3 },
        { transaction: fakeTx },
      );
      expect(day.update).toHaveBeenCalledWith(
        { coachChangedAt: expect.any(Date) },
        { transaction: fakeTx },
      );
    });

    it('refuses a date another day of the plan holds (409)', async () => {
      const day = dayRow();
      given(plan(), day);
      assignedWorkoutModel.findOne
        .mockResolvedValueOnce(day)
        .mockResolvedValueOnce({ id: 'd-2' });
      await expect(
        service.moveDay('a-1', 'd-1', { date: '2026-11-25' }, coach, today),
      ).rejects.toMatchObject({
        response: { messageKey: 'workout.copyDateTaken' },
      });
    });

    it('refuses a date after the plan ends (400)', async () => {
      const day = dayRow();
      given(plan(), day);
      assignedWorkoutModel.findOne
        .mockResolvedValueOnce(day)
        .mockResolvedValueOnce(null);
      await expect(
        service.moveDay('a-1', 'd-1', { date: '2027-01-04' }, coach, today),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('refuses the past (400)', async () => {
      const day = dayRow();
      given(plan(), day);
      assignedWorkoutModel.findOne
        .mockResolvedValueOnce(day)
        .mockResolvedValueOnce(null);
      await expect(
        service.moveDay('a-1', 'd-1', { date: '2026-11-18' }, coach, today),
      ).rejects.toMatchObject({
        response: { messageKey: 'workout.copyDatePast' },
      });
    });

    it('changes nothing when the date is the same', async () => {
      const day = dayRow();
      given(plan(), day);
      await service.moveDay('a-1', 'd-1', { date: '2026-11-23' }, coach, today);
      expect(day.update).not.toHaveBeenCalled();
    });
  });

  describe('Done tells the client once', () => {
    it('notifies after the commit about the days changed, naming the first', async () => {
      const assignment = plan();
      given(assignment, dayRow());
      userModel.findByPk.mockResolvedValue({
        firstName: 'Andrei',
        lastName: 'Pop',
      });
      assignedWorkoutModel.findAll.mockResolvedValue([
        {
          id: 'd-1',
          name: 'Push A',
          weekIndex: 2,
          scheduledDate: '2026-11-23',
        },
        {
          id: 'd-2',
          name: 'Pull A',
          weekIndex: 2,
          scheduledDate: '2026-11-25',
        },
      ]);

      const res = await service.finishEditing('a-1', coach);

      expect(res).toEqual({ notified: true, days: 2 });
      expect(events).toEqual(['commit', 'notify']);
      expect(assignment.update).toHaveBeenCalledWith(
        { coachChangesNotifiedAt: expect.any(Date) },
        { transaction: fakeTx },
      );
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'client-1',
          type: NotificationType.PLAN_ADJUSTED,
          message: {
            key: 'workout.planAdjusted',
            params: {
              coach: 'Andrei Pop',
              program: 'Strength Base',
              day: 'Push A',
              week: 3,
              others: 1,
            },
          },
          data: { screen: 'user/plans', entityId: 'a-1' },
        }),
      );
    });

    it('asks only for the days changed since the last notice', async () => {
      const told = new Date('2026-11-19T10:00:00Z');
      given(plan({ coachChangesNotifiedAt: told }), dayRow());
      assignedWorkoutModel.findAll.mockResolvedValue([]);

      await service.finishEditing('a-1', coach);

      const where = assignedWorkoutModel.findAll.mock.calls[0][0].where;
      expect(where.coachChangedAt).toEqual({ [Op.gt]: told });
    });

    it('sends nothing when nothing changed, so a second Done is silent', async () => {
      const assignment = plan();
      given(assignment, dayRow());
      assignedWorkoutModel.findAll.mockResolvedValue([]);

      expect(await service.finishEditing('a-1', coach)).toEqual({
        notified: false,
        days: 0,
      });
      expect(notificationService.notify).not.toHaveBeenCalled();
      expect(assignment.update).not.toHaveBeenCalled();
    });

    it('stays quiet about a plan that stopped running meanwhile', async () => {
      given(plan({ status: ProgramAssignmentStatus.Cancelled }), dayRow());
      assignedWorkoutModel.findAll.mockResolvedValue([
        {
          id: 'd-1',
          name: 'Push A',
          weekIndex: 2,
          scheduledDate: '2026-11-23',
        },
      ]);
      expect(await service.finishEditing('a-1', coach)).toEqual({
        notified: false,
        days: 1,
      });
      expect(notificationService.notify).not.toHaveBeenCalled();
    });
  });

  describe('reading the copy', () => {
    it('labels each day with its lock and counts its exercises', async () => {
      given(plan(), dayRow());
      assignedWorkoutModel.findAll.mockResolvedValue([
        dayRow({
          id: 'd-0',
          scheduledDate: '2026-11-16',
          status: WorkoutLogStatus.Completed,
        }),
        dayRow({ id: 'd-1', coachChangedAt: new Date() }),
      ]);
      logModel.findAll.mockResolvedValue([{ assignedWorkoutId: 'd-0' }]);
      assignedExerciseModel.findAll.mockResolvedValue([
        { assignedWorkoutId: 'd-1' },
        { assignedWorkoutId: 'd-1' },
      ]);

      const res = await service.overview('a-1', coach, today);

      expect(
        res.days.map((d) => [
          d.id,
          d.lock,
          d.editable,
          d.changed,
          d.exerciseCount,
        ]),
      ).toEqual([
        ['d-0', 'DONE', false, false, 0],
        ['d-1', null, true, true, 2],
      ]);
      expect(res.assignment.client).toEqual(
        expect.objectContaining({ firstName: 'Andrei' }),
      );
    });

    it("carries each exercise's label, program values and last result", async () => {
      given(plan(), dayRow());
      assignedExerciseModel.findAll.mockResolvedValue([
        {
          ...exerciseRow({
            exerciseId: 'db-press',
            isModifiedFromMaster: true,
          }),
          exercise: { id: 'db-press', name: 'Seated dumbbell press' },
          sets: [],
        },
      ]);
      logModel.findAll.mockResolvedValue([]);
      prescribedExerciseModel.findAll.mockResolvedValue([programRow()]);
      assignedWorkoutModel.findAll.mockResolvedValue([
        { scheduledDate: '2026-11-25' },
      ]);
      coachAccess.visibleAssignmentIds.mockResolvedValue(['a-1']);
      sequelize.query.mockResolvedValue([
        {
          exerciseId: 'db-press',
          workoutLogId: 'l-1',
          performedAt: new Date('2026-11-09'),
          setType: 'NORMAL',
          reps: 8,
          weightKg: '57.50',
          durationSeconds: null,
          distanceMeters: null,
          rpe: '8.0',
        },
        {
          exerciseId: 'db-press',
          workoutLogId: 'l-1',
          performedAt: new Date('2026-11-09'),
          setType: 'NORMAL',
          reps: 7,
          weightKg: '57.50',
          durationSeconds: null,
          distanceMeters: null,
          rpe: '9.0',
        },
      ]);

      const res = await service.day('a-1', 'd-1', coach, today);
      const [exercise] = res.day.exercises;

      expect(exercise.change).toBe('REPLACED');
      expect(exercise.canRevert).toBe(true);
      expect(exercise.program?.exerciseId).toBe('bench');
      expect(exercise.program?.sets.map((s) => s.restAfterSeconds)).toEqual([
        90, 90,
      ]);
      expect(exercise.lastResult).toEqual(
        expect.objectContaining({
          workoutLogId: 'l-1',
          averageRpe: 8.5,
          sets: [
            expect.objectContaining({ reps: 8, weightKg: 57.5, rpe: 8 }),
            expect.objectContaining({ reps: 7, weightKg: 57.5, rpe: 9 }),
          ],
        }),
      );
      expect(res.move).toEqual({
        from: today,
        to: '2026-12-25',
        taken: ['2026-11-25'],
      });
      // The coach's read rule: their own plans, or what the client shared.
      const sql = sequelize.query.mock.calls[0][0] as string;
      expect(sql).toContain(
        'wl.program_assignment_id IN (:own) OR wl.visibility IN (:shared)',
      );
    });
  });
});
