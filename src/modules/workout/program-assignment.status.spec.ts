import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { Op, literal } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { InstructorClient } from '../client/entities/instructor-client.entity';
import {
  NotificationService,
  NotificationType,
} from '../notification/notification.service';
import { User } from '../user/entities/user.entity';
import { AssignedExercise } from './entities/assigned-exercise.entity';
import { AssignedSet } from './entities/assigned-set.entity';
import { AssignedWorkout } from './entities/assigned-workout.entity';
import { Program } from './entities/program.entity';
import { ProgramAssignment } from './entities/program-assignment.entity';
import {
  ProgramAssignmentStatus,
  WorkoutLogStatus,
} from './entities/workout.enums';
import { ProgramAssignmentService } from './program-assignment.service';
import {
  fakeTx,
  makeSilentLogger,
} from '../../../test/helpers/sequelize-mocks';

/**
 * A coach pauses, resumes, finishes or cancels a client's plan (owner,
 * 2026-11-20): who and when are kept with the coach's message, resuming
 * moves the days left open since the pause by whole weeks, and the client
 * is told once it has committed.
 */
describe('ProgramAssignmentService — a coach changes a plan', () => {
  let service: ProgramAssignmentService;
  const coach = 'coach-1';
  /** Records the order things happened in, to prove notify-after-commit. */
  let events: string[];

  const assignmentModel = {
    findByPk: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
  };
  const assignedWorkoutModel = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
    destroy: jest.fn(),
  };
  const instructorClientModel = { findOne: jest.fn() };
  const userModel = { findByPk: jest.fn() };
  const sequelize = {
    transaction: jest.fn(async (cb: (tx: unknown) => unknown) => {
      const out = await cb(fakeTx);
      events.push('commit');
      return out;
    }),
  };
  const notificationService = {
    notify: jest.fn(() => {
      events.push('notify');
      return Promise.resolve();
    }),
  };

  /** A plan row as the model hands it back, with `update` merging in. */
  function planRow(overrides: Partial<ProgramAssignment> = {}) {
    const row = {
      id: 'a-1',
      instructorId: coach,
      clientId: 'client-1',
      programNameSnapshot: 'Strength Base',
      status: ProgramAssignmentStatus.Active,
      startDate: '2026-11-02',
      endDate: '2026-12-25',
      completionPercent: 42,
      statusChangedAt: null as Date | null,
      statusChangedBy: null as string | null,
      statusMessage: null as string | null,
      updatedAt: new Date('2026-11-02T08:00:00Z'),
      ...overrides,
      update: jest.fn((changes: Record<string, unknown>) => {
        Object.assign(row, changes);
        return Promise.resolve();
      }),
    };
    return row;
  }

  function given(row: ReturnType<typeof planRow>) {
    // Read once to check ownership, then again under the lock.
    assignmentModel.findByPk.mockResolvedValue(row);
    instructorClientModel.findOne.mockResolvedValue({ id: 'rel-1' });
    userModel.findByPk.mockResolvedValue({
      firstName: 'Andrei',
      lastName: 'Pop',
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
    assignedWorkoutModel.update.mockResolvedValue([0]);
    assignedWorkoutModel.count.mockResolvedValue(0);

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
        { provide: getModelToken(AssignedExercise), useValue: {} },
        { provide: getModelToken(AssignedSet), useValue: {} },
        { provide: getModelToken(Program), useValue: {} },
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

  function notified() {
    return notificationService.notify.mock.calls.map(
      (call) => (call as unknown[])[0],
    ) as {
      userId: string;
      type: string;
      message: { key: string; params: Record<string, unknown> };
      data: { screen: string; entityId: string };
    }[];
  }

  describe('pause', () => {
    it('records who and when with the message, then tells the client after the commit', async () => {
      const row = planRow();
      given(row);

      await service.update(
        'a-1',
        {
          status: ProgramAssignmentStatus.Paused,
          message: '  Luăm o pauză <b>cât ești în vacanță</b>.  ',
        },
        coach,
        '2026-11-19',
      );

      expect(assignmentModel.findByPk).toHaveBeenLastCalledWith('a-1', {
        transaction: fakeTx,
        lock: fakeTx.LOCK.UPDATE,
      });
      expect(row.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ProgramAssignmentStatus.Paused,
          statusChangedBy: coach,
          statusChangedAt: expect.any(Date),
          statusMessage: 'Luăm o pauză cât ești în vacanță.',
        }),
        { transaction: fakeTx },
      );
      expect(events).toEqual(['commit', 'notify']);
      const [notice] = notified();
      expect(notice).toMatchObject({
        userId: 'client-1',
        type: NotificationType.PLAN_PAUSED,
        message: {
          key: 'workout.planPaused',
          params: {
            coach: 'Andrei Pop',
            program: 'Strength Base',
            note: 'Luăm o pauză cât ești în vacanță.',
          },
        },
        data: { screen: 'user/plans', entityId: 'a-1' },
      });
    });

    it('keeps no message when the coach wrote only spaces', async () => {
      const row = planRow();
      given(row);

      await service.update(
        'a-1',
        { status: ProgramAssignmentStatus.Paused, message: '   ' },
        coach,
      );

      expect(row.statusMessage).toBeNull();
      expect(notified()[0].message.params.note).toBeNull();
    });

    it('moves no day: a paused plan keeps its calendar until it resumes', async () => {
      given(planRow());

      await service.update(
        'a-1',
        { status: ProgramAssignmentStatus.Paused },
        coach,
      );

      expect(assignedWorkoutModel.update).not.toHaveBeenCalled();
    });
  });

  describe('resume', () => {
    function pausedOn(day: string) {
      return planRow({
        status: ProgramAssignmentStatus.Paused,
        statusChangedAt: new Date(`${day}T10:00:00Z`),
        statusChangedBy: coach,
        statusMessage: 'Pauză',
      });
    }

    it('moves the days left open since the pause by whole weeks, in the same transaction', async () => {
      const row = pausedOn('2026-11-18');
      given(row);
      assignedWorkoutModel.findOne
        .mockResolvedValueOnce({ id: 'aw-1', scheduledDate: '2026-11-18' })
        .mockResolvedValueOnce({ id: 'aw-9', scheduledDate: '2027-01-08' });

      // Resumed two weeks later, on the same weekday: two weeks.
      await service.update(
        'a-1',
        { status: ProgramAssignmentStatus.Active },
        coach,
        '2026-12-02',
      );

      const where = {
        programAssignmentId: 'a-1',
        status: null,
        scheduledDate: { [Op.gte]: '2026-11-18' },
      };
      expect(assignedWorkoutModel.findOne).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where,
          order: [['scheduledDate', 'ASC']],
          transaction: fakeTx,
        }),
      );
      expect(assignedWorkoutModel.update).toHaveBeenCalledWith(
        { scheduledDate: literal('scheduled_date + 14') },
        { where, transaction: fakeTx },
      );
      // The plan ends on its last day, wherever that moved to.
      expect(row.update).toHaveBeenCalledWith(
        { endDate: '2027-01-08' },
        { transaction: fakeTx },
      );
      expect(row.status).toBe(ProgramAssignmentStatus.Active);
      expect(row.statusMessage).toBeNull();
      expect(events).toEqual(['commit', 'notify']);
      expect(notified()[0]).toMatchObject({
        type: NotificationType.PLAN_RESUMED,
        message: { key: 'workout.planResumed', params: { weeks: 2 } },
      });
    });

    it('rounds a part week up, so no open day is left in the past', async () => {
      given(pausedOn('2026-11-18'));
      assignedWorkoutModel.findOne
        .mockResolvedValueOnce({ id: 'aw-1', scheduledDate: '2026-11-20' })
        .mockResolvedValueOnce({ id: 'aw-9', scheduledDate: '2027-01-08' });

      await service.update(
        'a-1',
        { status: ProgramAssignmentStatus.Active },
        coach,
        '2026-11-23',
      );

      expect(assignedWorkoutModel.update).toHaveBeenCalledWith(
        { scheduledDate: literal('scheduled_date + 7') },
        expect.anything(),
      );
    });

    it('counts across a month end', async () => {
      given(pausedOn('2026-01-28'));
      assignedWorkoutModel.findOne
        .mockResolvedValueOnce({ id: 'aw-1', scheduledDate: '2026-01-28' })
        .mockResolvedValueOnce({ id: 'aw-9', scheduledDate: '2026-03-20' });

      await service.update(
        'a-1',
        { status: ProgramAssignmentStatus.Active },
        coach,
        '2026-02-05',
      );

      expect(assignedWorkoutModel.update).toHaveBeenCalledWith(
        { scheduledDate: literal('scheduled_date + 14') },
        expect.anything(),
      );
      expect(notified()[0].message.params.weeks).toBe(2);
    });

    it('moves nothing when no open day has fallen behind', async () => {
      given(pausedOn('2026-11-18'));
      assignedWorkoutModel.findOne.mockResolvedValueOnce({
        id: 'aw-1',
        scheduledDate: '2026-11-20',
      });

      await service.update(
        'a-1',
        { status: ProgramAssignmentStatus.Active },
        coach,
        '2026-11-19',
      );

      expect(assignedWorkoutModel.update).not.toHaveBeenCalled();
      expect(notified()[0].message.params.weeks).toBe(0);
    });

    it('moves nothing when every day since the pause is done', async () => {
      given(pausedOn('2026-11-18'));
      assignedWorkoutModel.findOne.mockResolvedValueOnce(null);

      await service.update(
        'a-1',
        { status: ProgramAssignmentStatus.Active },
        coach,
        '2026-12-30',
      );

      expect(assignedWorkoutModel.update).not.toHaveBeenCalled();
    });

    it('reads a plan paused before the pause was recorded from its last update', async () => {
      const row = planRow({
        status: ProgramAssignmentStatus.Paused,
        updatedAt: new Date('2026-11-10T09:00:00Z'),
      });
      given(row);
      assignedWorkoutModel.findOne
        .mockResolvedValueOnce({ id: 'aw-1', scheduledDate: '2026-11-11' })
        .mockResolvedValueOnce({ id: 'aw-9', scheduledDate: '2027-01-08' });

      await service.update(
        'a-1',
        { status: ProgramAssignmentStatus.Active },
        coach,
        '2026-11-20',
      );

      expect(assignedWorkoutModel.findOne).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          where: expect.objectContaining({
            scheduledDate: { [Op.gte]: '2026-11-10' },
          }),
        }),
      );
    });
  });

  describe('finish early', () => {
    it('keeps the percent actually done and tells the client, not the coach', async () => {
      const row = planRow();
      given(row);
      // 10 days in the plan, 4 done.
      assignedWorkoutModel.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(4);

      await service.update(
        'a-1',
        {
          status: ProgramAssignmentStatus.Completed,
          message: 'Ai prins ritmul.',
        },
        coach,
      );

      expect(row.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: ProgramAssignmentStatus.Completed,
          completionPercent: 40,
          statusChangedBy: coach,
        }),
        { transaction: fakeTx },
      );
      const notices = notified();
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        userId: 'client-1',
        type: NotificationType.PLAN_FINISHED_BY_COACH,
        message: { params: { percent: 40, note: 'Ai prins ritmul.' } },
      });
    });
  });

  describe('cancel', () => {
    it('keeps every finished workout and says how many', async () => {
      const row = planRow();
      given(row);
      assignedWorkoutModel.count.mockResolvedValueOnce(7);

      await service.update(
        'a-1',
        { status: ProgramAssignmentStatus.Cancelled },
        coach,
      );

      expect(assignedWorkoutModel.destroy).not.toHaveBeenCalled();
      expect(assignedWorkoutModel.update).not.toHaveBeenCalled();
      expect(row.status).toBe(ProgramAssignmentStatus.Cancelled);
      expect(assignedWorkoutModel.count).toHaveBeenCalledWith({
        where: {
          programAssignmentId: 'a-1',
          status: WorkoutLogStatus.Completed,
        },
      });
      expect(notified()[0]).toMatchObject({
        type: NotificationType.PLAN_CANCELLED,
        message: {
          key: 'workout.planCancelled',
          params: { done: 7, note: null },
        },
      });
    });

    it('refuses to change a cancelled plan again, and tells no one', async () => {
      given(planRow({ status: ProgramAssignmentStatus.Cancelled }));

      await expect(
        service.update(
          'a-1',
          { status: ProgramAssignmentStatus.Active },
          coach,
        ),
      ).rejects.toThrow(BadRequestException);
      expect(notificationService.notify).not.toHaveBeenCalled();
    });
  });

  describe('what is not a change', () => {
    it('saves a note alone without touching the status or telling anyone', async () => {
      const row = planRow();
      given(row);

      await service.update('a-1', { notes: ' Focus on form ' }, coach);

      expect(row.update).toHaveBeenCalledWith(
        { notes: 'Focus on form' },
        { transaction: fakeTx },
      );
      expect(notificationService.notify).not.toHaveBeenCalled();
    });

    it('ignores the same status sent again: no move, no notice', async () => {
      const row = planRow({ status: ProgramAssignmentStatus.Paused });
      given(row);

      await service.update(
        'a-1',
        { status: ProgramAssignmentStatus.Paused, message: 'Again' },
        coach,
      );

      expect(row.update).toHaveBeenCalledWith({}, { transaction: fakeTx });
      expect(notificationService.notify).not.toHaveBeenCalled();
    });

    it('keeps the change when the notice fails', async () => {
      const row = planRow();
      given(row);
      notificationService.notify.mockRejectedValueOnce(new Error('down'));

      await expect(
        service.update(
          'a-1',
          { status: ProgramAssignmentStatus.Paused },
          coach,
        ),
      ).resolves.toBe(row);
      expect(row.status).toBe(ProgramAssignmentStatus.Paused);
    });
  });

  describe('the nightly auto-skip', () => {
    it('only looks at running plans, so a paused one keeps its days', async () => {
      assignedWorkoutModel.findAll.mockResolvedValueOnce([]);

      await service.autoSkipPastWorkouts('2026-11-20');

      const opts = assignedWorkoutModel.findAll.mock.calls[0][0] as {
        include: { where: { status: string } }[];
      };
      expect(opts.include[0].where).toEqual({
        status: ProgramAssignmentStatus.Active,
      });
    });
  });

  describe("the client's Workouts tab", () => {
    const instructor = { id: coach, firstName: 'Andrei' };

    it('shows paused plans and the ones the coach ended lately, with what was done', async () => {
      assignmentModel.findAll.mockResolvedValueOnce([]).mockResolvedValueOnce([
        {
          id: 'p-paused',
          instructorId: coach,
          programNameSnapshot: 'Strength Base',
          status: ProgramAssignmentStatus.Paused,
          completionPercent: 42,
          startDate: '2026-11-02',
          endDate: '2026-12-25',
          assignmentKind: 'COACH',
          instructor,
          statusChangedAt: new Date('2026-11-19T10:00:00Z'),
          statusChangedBy: coach,
          statusMessage: 'Vacanță',
        },
        {
          id: 'p-cancelled',
          instructorId: coach,
          programNameSnapshot: 'Return to running',
          status: ProgramAssignmentStatus.Cancelled,
          completionPercent: 30,
          startDate: '2026-10-05',
          endDate: '2026-11-15',
          assignmentKind: 'COACH',
          instructor,
          statusChangedAt: new Date('2026-11-12T10:00:00Z'),
          statusChangedBy: coach,
          statusMessage: null,
        },
        {
          // Not ended by their coach: left out.
          id: 'p-other',
          instructorId: coach,
          programNameSnapshot: 'Mobility',
          status: ProgramAssignmentStatus.Cancelled,
          completionPercent: 0,
          startDate: '2026-10-05',
          endDate: null,
          assignmentKind: 'COACH',
          instructor,
          statusChangedAt: new Date('2026-11-12T10:00:00Z'),
          statusChangedBy: 'admin-1',
          statusMessage: null,
        },
      ]);
      assignedWorkoutModel.count
        .mockResolvedValueOnce(9)
        .mockResolvedValueOnce(7);

      const res = await service.getTrainingDay('client-1', '2026-11-20');

      expect(res.activePlans).toEqual([]);
      expect(res.stoppedPlans.map((p) => p.id)).toEqual([
        'p-paused',
        'p-cancelled',
      ]);
      expect(res.stoppedPlans[1]).toMatchObject({
        status: ProgramAssignmentStatus.Cancelled,
        workoutsDone: 7,
        statusMessage: null,
        statusChangedAt: new Date('2026-11-12T10:00:00Z'),
      });
      expect(res.stoppedPlans[0].statusMessage).toBe('Vacanță');

      const where = (
        assignmentModel.findAll.mock.calls[1][0] as {
          where: Record<string | symbol, unknown>;
        }
      ).where;
      expect(where).toMatchObject({
        clientId: 'client-1',
        assignmentKind: 'COACH',
      });
    });
  });
});
