import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import {
  InstructorClient,
  InstructorClientStatus,
} from '../client/entities/instructor-client.entity';
import { Exercise } from '../exercise/entities/exercise.entity';
import { NotificationService } from '../notification/notification.service';
import { User } from '../user/entities/user.entity';
import { AssignedExercise } from './entities/assigned-exercise.entity';
import { AssignedSet } from './entities/assigned-set.entity';
import { AssignedWorkout } from './entities/assigned-workout.entity';
import { Program } from './entities/program.entity';
import { ProgramAssignment } from './entities/program-assignment.entity';
import { ProgramAssignmentStatus } from './entities/workout.enums';
import { ProgramAssignmentService } from './program-assignment.service';
import { NotificationType } from '../notification/notification.service';
import {
  fakeTx,
  makeSilentLogger,
} from '../../../test/helpers/sequelize-mocks';

/**
 * Smoke tests for ProgramAssignmentService — the headliner. Covers:
 *   - happy-path deep-copy (writes counted at every level)
 *   - ownership preconditions (program owner, active client rel)
 *   - scheduled-date math across week / day boundaries (including DST)
 *   - status transition gate (terminal states are sticky)
 *   - cross-tenant hide-existence on detail reads
 */
describe('ProgramAssignmentService (smoke — not exhaustive)', () => {
  let service: ProgramAssignmentService;

  const assignmentModel = {
    findByPk: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  };
  const assignedWorkoutModel = {
    create: jest.fn(),
    findAll: jest.fn(),
    count: jest.fn(),
  };
  const assignedExerciseModel = { create: jest.fn(), findAll: jest.fn() };
  const assignedSetModel = { bulkCreate: jest.fn() };
  const programModel = { findByPk: jest.fn() };
  const instructorClientModel = { findOne: jest.fn() };
  const userModel = { findByPk: jest.fn() };
  const sequelize = {
    transaction: jest.fn((cb: (tx: unknown) => unknown) =>
      Promise.resolve(cb(fakeTx)),
    ),
  };
  const notificationService = {
    notify: jest.fn().mockResolvedValue(undefined),
  };

  const me = 'i-1';

  beforeEach(async () => {
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        ProgramAssignmentService,
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
        { provide: getModelToken(Program), useValue: programModel },
        {
          provide: getModelToken(InstructorClient),
          useValue: instructorClientModel,
        },
        { provide: getModelToken(User), useValue: userModel },
        { provide: Sequelize, useValue: sequelize },
        { provide: NotificationService, useValue: notificationService },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();
    service = module.get(ProgramAssignmentService);
  });

  // Stub out a tiny tree: 1 workout, 1 exercise slot, 2 sets.
  const buildTinyProgram = () => ({
    id: 'prog-1',
    ownerId: me,
    name: 'Tiny program',
    durationDays: 14,
    deletedAt: null,
    workouts: [
      {
        id: 'pw-1',
        name: 'Day 1',
        notes: null,
        weekIndex: 0,
        dayIndex: 0,
        sequenceNumber: 0,
        phase: null,
        estimatedDurationMinutes: 45,
        exercises: [
          {
            id: 'pe-1',
            exerciseId: 'ex-1',
            supersetGroupId: null,
            orderIndex: 0,
            notes: null,
            alternateExerciseId: null,
            sets: [
              {
                id: 'ps-1',
                orderIndex: 0,
                setType: 'NORMAL',
                targetRepsMin: 5,
                targetRepsMax: 5,
                targetWeightKg: 80,
                targetWeightPercent1rm: null,
                targetDurationSeconds: null,
                targetDistanceMeters: null,
                targetRpe: 8,
                targetRir: null,
                restAfterSeconds: 90,
                tempo: null,
                notes: null,
              },
              {
                id: 'ps-2',
                orderIndex: 1,
                setType: 'NORMAL',
                targetRepsMin: 5,
                targetRepsMax: 5,
                targetWeightKg: 82.5,
                targetWeightPercent1rm: null,
                targetDurationSeconds: null,
                targetDistanceMeters: null,
                targetRpe: 8,
                targetRir: null,
                restAfterSeconds: 90,
                tempo: null,
                notes: null,
              },
            ],
          },
        ],
      },
    ],
  });

  const setupHappyPath = () => {
    programModel.findByPk.mockResolvedValueOnce(buildTinyProgram());
    instructorClientModel.findOne.mockResolvedValueOnce({
      id: 'ic-1',
      status: InstructorClientStatus.ACTIVE,
    });
    userModel.findByPk.mockResolvedValueOnce({
      id: 'c-1',
      firstName: 'Cli',
      lastName: 'Ent',
    });
    assignmentModel.create.mockResolvedValueOnce({
      id: 'pa-1',
      instructorId: me,
      clientId: 'c-1',
    });
    assignedWorkoutModel.create.mockResolvedValueOnce({ id: 'aw-1' });
    assignedExerciseModel.create.mockResolvedValueOnce({ id: 'ae-1' });
  };

  // ─── Deep-copy happy path ────────────────────────────────────────

  describe('autoCompleteAssignments — telling the coach', () => {
    const finishedAssignment = {
      id: 'asg-1',
      instructorId: 'coach-1',
      clientId: 'client-1',
      programNameSnapshot: 'Beginner Strength',
    };

    beforeEach(() => {
      assignmentModel.findAll.mockResolvedValue([finishedAssignment]);
      // total workouts = 8, outstanding = 0 → the plan is finished.
      assignedWorkoutModel.count
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(0);
      userModel.findByPk.mockResolvedValue({
        firstName: 'Anna',
        lastName: 'Popescu',
      });
    });

    it('selects the fields the notification needs', async () => {
      assignmentModel.update.mockResolvedValue([1]);

      await service.autoCompleteAssignments();

      // The mock hands back a fully-populated row, so a too-narrow
      // `attributes` list passes every other assertion here while the
      // real query returns undefined and the notification silently
      // skips. Pin the projection itself.
      const opts = assignmentModel.findAll.mock.calls[0][0] as {
        attributes: string[];
      };
      expect(opts.attributes).toEqual(
        expect.arrayContaining([
          'instructorId',
          'clientId',
          'programNameSnapshot',
        ]),
      );
    });

    it('notifies the instructor when a plan finishes', async () => {
      assignmentModel.update.mockResolvedValue([1]);

      await service.autoCompleteAssignments();

      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'coach-1',
          type: NotificationType.CLIENT_COMPLETED_PLAN,
        }),
      );
    });

    it('stays silent on a re-run, when the row was already completed', async () => {
      // The `status = ACTIVE` guard means a second sweep updates nothing.
      assignmentModel.update.mockResolvedValue([0]);

      await service.autoCompleteAssignments();

      expect(notificationService.notify).not.toHaveBeenCalled();
    });
  });

  describe('listForInstructor — search', () => {
    const whereOf = () =>
      (
        assignmentModel.findAndCountAll.mock.calls[0][0] as {
          where: Record<string, unknown>;
        }
      ).where;

    beforeEach(() => {
      assignmentModel.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
    });

    it('omits the name clause entirely when no term is given', async () => {
      await service.listForInstructor(me, { clientId: 'c-1' });
      expect(whereOf()).not.toHaveProperty('programNameSnapshot');
    });

    it('treats whitespace as no search', async () => {
      await service.listForInstructor(me, { clientId: 'c-1', search: '   ' });
      expect(whereOf()).not.toHaveProperty('programNameSnapshot');
    });

    it('escapes LIKE wildcards so % cannot match everything', async () => {
      await service.listForInstructor(me, { clientId: 'c-1', search: '100%' });
      const clause = whereOf()['programNameSnapshot'] as Record<symbol, string>;
      const value = Object.getOwnPropertySymbols(clause)
        .map((sym) => clause[sym])
        .find((v) => typeof v === 'string');
      expect(value).toBe('%100\\%%');
    });
  });

  describe('assignProgramToClient — happy path', () => {
    it('clones the tree atomically and fires the notification post-commit', async () => {
      setupHappyPath();

      await service.assignProgramToClient(me, 'Coach Co.', {
        programId: 'prog-1',
        clientId: 'c-1',
        startDate: '2026-06-09',
      });

      expect(sequelize.transaction).toHaveBeenCalledTimes(1);
      expect(assignmentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          instructorId: me,
          clientId: 'c-1',
          masterProgramId: 'prog-1',
          programNameSnapshot: 'Tiny program',
          startDate: '2026-06-09',
          // The work decides the window, not `durationDays`: the program
          // declares 2 weeks but holds one session, on the start date.
          endDate: '2026-06-09',
          status: ProgramAssignmentStatus.Active,
        }),
        { transaction: fakeTx },
      );
      expect(assignedWorkoutModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          masterWorkoutId: 'pw-1',
          scheduledDate: '2026-06-09', // week 0 day 0 → startDate
        }),
        { transaction: fakeTx },
      );
      expect(assignedExerciseModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          masterExerciseId: 'pe-1',
          exerciseId: 'ex-1',
        }),
        { transaction: fakeTx },
      );
      // Both prescribed_set rows go through one bulkCreate per exercise.
      expect(assignedSetModel.bulkCreate).toHaveBeenCalledTimes(1);
      const rows = assignedSetModel.bulkCreate.mock.calls[0][0];
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual(
        expect.objectContaining({
          masterSetId: 'ps-1',
          targetWeightKg: 80,
        }),
      );
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'c-1',
          type: 'PROGRAM_ASSIGNED',
        }),
      );
    });
  });

  // ─── Preconditions ───────────────────────────────────────────────

  describe('assignProgramToClient — mapping days onto weekdays', () => {
    /** Mon + Wed in week 0, Mon in week 1 — three sessions, two day slots. */
    const twoDayProgram = () => ({
      id: 'prog-1',
      ownerId: me,
      name: 'Two-day split',
      durationDays: 14,
      deletedAt: null,
      workouts: [
        {
          id: 'pw-1',
          name: 'Upper',
          notes: null,
          weekIndex: 0,
          dayIndex: 0,
          sequenceNumber: 0,
          phase: null,
          estimatedDurationMinutes: 45,
          exercises: [],
        },
        {
          id: 'pw-2',
          name: 'Lower',
          notes: null,
          weekIndex: 0,
          dayIndex: 2,
          sequenceNumber: 1,
          phase: null,
          estimatedDurationMinutes: 45,
          exercises: [],
        },
        {
          id: 'pw-3',
          name: 'Upper',
          notes: null,
          weekIndex: 1,
          dayIndex: 0,
          sequenceNumber: 2,
          phase: null,
          estimatedDurationMinutes: 45,
          exercises: [],
        },
      ],
    });

    const setup = () => {
      programModel.findByPk.mockResolvedValueOnce(twoDayProgram());
      instructorClientModel.findOne.mockResolvedValueOnce({
        id: 'ic-1',
        status: InstructorClientStatus.ACTIVE,
      });
      userModel.findByPk.mockResolvedValueOnce({
        id: 'c-1',
        firstName: 'Cli',
        lastName: 'Ent',
      });
      assignmentModel.create.mockResolvedValueOnce({ id: 'pa-1' });
      assignedWorkoutModel.create.mockResolvedValue({ id: 'aw-x' });
    };

    const scheduled = () =>
      assignedWorkoutModel.create.mock.calls.map(([attrs]) => ({
        name: attrs.name,
        dayIndex: attrs.dayIndex,
        date: attrs.scheduledDate,
      }));

    it('lands each program day on the weekday it was mapped to', async () => {
      // 2026-06-09 is a Tuesday. Mapped to Tue(2)/Thu(4), so the program's
      // day 0 -> Tuesday and day 2 -> Thursday, week after week.
      setup();

      await service.assignProgramToClient(me, 'Coach Co.', {
        programId: 'prog-1',
        clientId: 'c-1',
        startDate: '2026-06-09',
        daysOfWeek: [2, 4],
      });

      expect(scheduled()).toEqual([
        { name: 'Upper', dayIndex: 1, date: '2026-06-09' }, // Tue
        { name: 'Lower', dayIndex: 3, date: '2026-06-11' }, // Thu
        { name: 'Upper', dayIndex: 1, date: '2026-06-16' }, // Tue, next week
      ]);
    });

    it('keeps counting from the start date when no mapping is asked for', async () => {
      // The original behaviour: day 0 lands on the start date itself.
      setup();

      await service.assignProgramToClient(me, 'Coach Co.', {
        programId: 'prog-1',
        clientId: 'c-1',
        startDate: '2026-06-09',
      });

      expect(scheduled()).toEqual([
        { name: 'Upper', dayIndex: 0, date: '2026-06-09' },
        { name: 'Lower', dayIndex: 2, date: '2026-06-11' },
        { name: 'Upper', dayIndex: 0, date: '2026-06-16' },
      ]);
    });

    it('ends on the last session even when the program under-declares its length', async () => {
      // The bug this guards: `durationDays` was a free-form hint nothing
      // validated, but the end date counted it forward as fact. A program
      // claiming one week while holding two left the client with sessions
      // scheduled past the date their own plan said it ended.
      const under = twoDayProgram();
      under.durationDays = 7;
      programModel.findByPk.mockResolvedValueOnce(under);
      instructorClientModel.findOne.mockResolvedValueOnce({
        id: 'ic-1',
        status: InstructorClientStatus.ACTIVE,
      });
      userModel.findByPk.mockResolvedValueOnce({
        id: 'c-1',
        firstName: 'Cli',
        lastName: 'Ent',
      });
      assignmentModel.create.mockResolvedValueOnce({ id: 'pa-1' });
      assignedWorkoutModel.create.mockResolvedValue({ id: 'aw-x' });

      await service.assignProgramToClient(me, 'Coach Co.', {
        programId: 'prog-1',
        clientId: 'c-1',
        startDate: '2026-06-09',
      });

      // Week 1's session is on the 16th; the declared week would have
      // ended it on the 15th.
      expect(assignmentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ endDate: '2026-06-16' }),
        expect.anything(),
      );
    });

    it('ends the window on the last session it actually scheduled', async () => {
      setup();

      await service.assignProgramToClient(me, 'Coach Co.', {
        programId: 'prog-1',
        clientId: 'c-1',
        startDate: '2026-06-09',
        daysOfWeek: [2, 4],
      });

      expect(assignmentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ endDate: '2026-06-16' }),
        expect.anything(),
      );
    });

    it('refuses a day count the program cannot take', async () => {
      // Two training days cannot be squeezed into one, or spread over three
      // without inventing a session.
      setup();

      await expect(
        service.assignProgramToClient(me, 'Coach Co.', {
          programId: 'prog-1',
          clientId: 'c-1',
          startDate: '2026-06-09',
          daysOfWeek: [1, 3, 5],
        }),
      ).rejects.toThrow(BadRequestException);

      expect(assignmentModel.create).not.toHaveBeenCalled();
    });

    it('does not back-fill before the start date', async () => {
      // 2026-06-11 is a Thursday; mapping to Mon/Wed would put week 0 in the
      // past. The grid is anchored on the start week's Monday, so those
      // sessions sit earlier in the same week — which is the program's own
      // shape, not a back-fill of a week that already happened.
      setup();

      await service.assignProgramToClient(me, 'Coach Co.', {
        programId: 'prog-1',
        clientId: 'c-1',
        startDate: '2026-06-11',
        daysOfWeek: [1, 3],
      });

      const dates = scheduled().map((w) => w.date);
      expect(dates).toEqual(['2026-06-08', '2026-06-10', '2026-06-15']);
    });
  });

  describe('assignProgramToClient — preconditions', () => {
    const dto = {
      programId: 'prog-1',
      clientId: 'c-1',
      startDate: '2026-06-09',
    };

    it('throws 404 when the program is not owned by the instructor', async () => {
      programModel.findByPk.mockResolvedValueOnce({
        ...buildTinyProgram(),
        ownerId: 'someone-else',
      });
      await expect(
        service.assignProgramToClient(me, 'Coach', dto),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws 400 when the program is soft-deleted', async () => {
      programModel.findByPk.mockResolvedValueOnce({
        ...buildTinyProgram(),
        deletedAt: new Date(),
      });
      await expect(
        service.assignProgramToClient(me, 'Coach', dto),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws 403 when no ACTIVE instructor↔client relationship exists', async () => {
      programModel.findByPk.mockResolvedValueOnce(buildTinyProgram());
      instructorClientModel.findOne.mockResolvedValueOnce(null);
      await expect(
        service.assignProgramToClient(me, 'Coach', dto),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── Scheduled-date math ─────────────────────────────────────────

  describe('scheduled date math', () => {
    it('lands week 1 day 3 on startDate + 10 days, across month boundary', async () => {
      programModel.findByPk.mockResolvedValueOnce({
        id: 'p',
        ownerId: me,
        name: 'P',
        durationDays: null,
        deletedAt: null,
        workouts: [
          {
            id: 'pw-x',
            name: 'D',
            notes: null,
            weekIndex: 1,
            dayIndex: 3,
            sequenceNumber: 0,
            phase: null,
            estimatedDurationMinutes: null,
            exercises: [],
          },
        ],
      });
      instructorClientModel.findOne.mockResolvedValueOnce({
        id: 'ic',
        status: InstructorClientStatus.ACTIVE,
      });
      userModel.findByPk.mockResolvedValueOnce({
        id: 'c',
        firstName: 'C',
        lastName: 'L',
      });
      assignmentModel.create.mockResolvedValueOnce({ id: 'pa' });
      assignedWorkoutModel.create.mockResolvedValueOnce({ id: 'aw' });

      await service.assignProgramToClient(me, 'Coach', {
        programId: 'p',
        clientId: 'c',
        startDate: '2026-05-25', // Mon
      });

      expect(assignedWorkoutModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          scheduledDate: '2026-06-04', // +10 days, May->June boundary
        }),
        expect.anything(),
      );
    });
  });

  // ─── Status transitions ──────────────────────────────────────────

  describe('scheduleRoutine — the light multi-week answer', () => {
    const routine = (over: Record<string, unknown> = {}) => ({
      id: 'p-1',
      ownerId: 'me',
      name: 'Push day A',
      workouts: [
        {
          id: 'pw-1',
          notes: null,
          estimatedDurationMinutes: 45,
          exercises: [],
        },
      ],
      ...over,
    });

    it("hides a routine that isn't yours", async () => {
      programModel.findByPk.mockResolvedValueOnce(
        routine({ ownerId: 'someone-else' }),
      );

      await expect(
        service.scheduleRoutine(
          'me',
          { programId: 'p-1', daysOfWeek: [1] },
          '2026-08-06',
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('refuses a block schedule with no length', async () => {
      programModel.findByPk.mockResolvedValueOnce(routine());

      await expect(
        service.scheduleRoutine(
          'me',
          { programId: 'p-1', daysOfWeek: [1], repeatMode: 'BLOCK' as never },
          '2026-08-06',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('fans a single workout across the chosen weekdays for a block', async () => {
      programModel.findByPk.mockResolvedValueOnce(routine());
      assignmentModel.create.mockResolvedValueOnce({ id: 'pa-1' });
      assignedWorkoutModel.create.mockResolvedValue({ id: 'aw-x' });

      // Thursday 2026-08-06, Mon+Fri, two weeks.
      await service.scheduleRoutine(
        'me',
        {
          programId: 'p-1',
          daysOfWeek: [1, 5],
          repeatMode: 'BLOCK' as never,
          repeatWeeks: 2,
        },
        '2026-08-06',
      );

      const dates = assignedWorkoutModel.create.mock.calls.map(
        (c) => (c[0] as { scheduledDate: string }).scheduledDate,
      );
      // Monday the 3rd is before the start date, so it is not back-filled.
      expect(dates).toEqual(['2026-08-07', '2026-08-10', '2026-08-14']);
    });

    it('marks the assignment as self-scheduled with no instructor', async () => {
      programModel.findByPk.mockResolvedValueOnce(routine());
      assignmentModel.create.mockResolvedValueOnce({ id: 'pa-1' });
      assignedWorkoutModel.create.mockResolvedValue({ id: 'aw-x' });

      await service.scheduleRoutine(
        'me',
        { programId: 'p-1', daysOfWeek: [3] },
        '2026-08-06',
      );

      expect(assignmentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          instructorId: null,
          assignmentKind: 'SELF',
          clientId: 'me',
          repeatMode: 'WEEKLY',
          // Rolling schedules carry no fixed length.
          repeatWeeks: null,
        }),
        expect.anything(),
      );
    });

    it('refuses to schedule an empty routine', async () => {
      programModel.findByPk.mockResolvedValueOnce(routine({ workouts: [] }));

      await expect(
        service.scheduleRoutine(
          'me',
          { programId: 'p-1', daysOfWeek: [1] },
          '2026-08-06',
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getTrainingDay — the Workouts front door', () => {
    const plan = {
      id: 'pa-1',
      programNameSnapshot: '12-week base',
      status: 'ACTIVE',
      completionPercent: 30,
      startDate: '2026-08-03',
      endDate: null,
      assignmentKind: 'COACH',
      instructor: { id: 'coach-1', firstName: 'Alex' },
    };

    it('returns empty rather than querying workouts when nothing is active', async () => {
      assignmentModel.findAll.mockResolvedValueOnce([]);

      const res = await service.getTrainingDay('me', '2026-08-06');

      expect(res).toEqual({ today: null, week: [], activePlans: [] });
      expect(assignedWorkoutModel.findAll).not.toHaveBeenCalled();
    });

    it('scopes the week Monday to Sunday around the given date', async () => {
      assignmentModel.findAll.mockResolvedValueOnce([plan]);
      assignedWorkoutModel.findAll.mockResolvedValueOnce([]);

      // 2026-08-06 is a Thursday.
      await service.getTrainingDay('me', '2026-08-06');

      const where = assignedWorkoutModel.findAll.mock.calls[0][0].where;
      const between =
        where.scheduledDate[
          Object.getOwnPropertySymbols(where.scheduledDate)[0]
        ];
      expect(between).toEqual(['2026-08-03', '2026-08-09']);
    });

    it('picks out today and leaves the rest of the week alongside it', async () => {
      assignmentModel.findAll.mockResolvedValueOnce([plan]);
      assignedWorkoutModel.findAll.mockResolvedValueOnce([
        {
          id: 'aw-1',
          programAssignmentId: 'pa-1',
          name: 'Lower',
          scheduledDate: '2026-08-06',
          status: null,
          weekIndex: 0,
          dayIndex: 3,
          estimatedDurationMinutes: 55,
        },
        {
          id: 'aw-2',
          programAssignmentId: 'pa-1',
          name: 'Upper',
          scheduledDate: '2026-08-08',
          status: null,
          weekIndex: 0,
          dayIndex: 5,
          estimatedDurationMinutes: 50,
        },
      ]);
      const squat = { id: 'ae-1', exercise: { name: 'Back squat' }, sets: [] };
      assignedExerciseModel.findAll.mockResolvedValueOnce([squat]);

      const res = await service.getTrainingDay('me', '2026-08-06');

      expect(res.today?.assignedWorkoutId).toBe('aw-1');
      // Plan context is denormalised onto each entry so the card can
      // render "from Alex" without a second lookup.
      expect(res.today?.planName).toBe('12-week base');
      expect(res.week).toHaveLength(2);
      // Only today carries its exercises; the week strip stays lean.
      expect(res.today?.exercises).toEqual([squat]);
      expect(assignedExerciseModel.findAll.mock.calls[0][0].where).toEqual({
        assignedWorkoutId: 'aw-1',
      });
      expect(res.week[1]).not.toHaveProperty('exercises');
    });

    it('reports a rest day as null, not as the next workout', async () => {
      assignmentModel.findAll.mockResolvedValueOnce([plan]);
      assignedWorkoutModel.findAll.mockResolvedValueOnce([
        {
          id: 'aw-2',
          programAssignmentId: 'pa-1',
          name: 'Upper',
          scheduledDate: '2026-08-08',
          status: null,
          weekIndex: 0,
          dayIndex: 5,
          estimatedDurationMinutes: 50,
        },
      ]);

      const res = await service.getTrainingDay('me', '2026-08-06');

      expect(res.today).toBeNull();
      expect(res.week).toHaveLength(1);
      expect(assignedExerciseModel.findAll).not.toHaveBeenCalled();
    });
  });

  describe('update — status transition gate', () => {
    it('blocks transitions out of COMPLETED', async () => {
      assignmentModel.findByPk.mockResolvedValueOnce({
        id: 'a-1',
        instructorId: me,
        status: ProgramAssignmentStatus.Completed,
        update: jest.fn(),
      });
      await expect(
        service.update('a-1', { status: ProgramAssignmentStatus.Active }, me),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows ACTIVE → PAUSED', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      assignmentModel.findByPk.mockResolvedValueOnce({
        id: 'a-1',
        instructorId: me,
        status: ProgramAssignmentStatus.Active,
        update,
      });
      await service.update(
        'a-1',
        { status: ProgramAssignmentStatus.Paused },
        me,
      );
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ status: ProgramAssignmentStatus.Paused }),
      );
    });
  });

  // ─── findById — cross-tenant hide ────────────────────────────────

  describe('findById', () => {
    it('hides existence when caller is neither instructor nor client', async () => {
      assignmentModel.findByPk.mockResolvedValueOnce({
        id: 'a-1',
        instructorId: 'someone',
        clientId: 'someone-else',
      });
      await expect(service.findById('a-1', 'me')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
