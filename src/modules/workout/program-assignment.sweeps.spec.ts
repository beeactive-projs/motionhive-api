import { Test } from '@nestjs/testing';
import { Op } from 'sequelize';
import { getModelToken } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import { NotificationService } from '../notification/notification.service';
import { User } from '../user/entities/user.entity';
import { AssignedExercise } from './entities/assigned-exercise.entity';
import { AssignedSet } from './entities/assigned-set.entity';
import { AssignedWorkout } from './entities/assigned-workout.entity';
import { Program } from './entities/program.entity';
import { ProgramAssignment } from './entities/program-assignment.entity';
import { WorkoutLogStatus } from './entities/workout.enums';
import { ProgramAssignmentService } from './program-assignment.service';
import {
  fakeTx,
  makeSilentLogger,
} from '../../../test/helpers/sequelize-mocks';

describe('ProgramAssignmentService — system sweeps', () => {
  let service: ProgramAssignmentService;

  const assignmentModel = {
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
  const assignedWorkoutModel = {
    findAll: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  };
  const sequelize = {
    transaction: jest.fn((cb: (tx: unknown) => unknown) =>
      Promise.resolve(cb(fakeTx)),
    ),
  };

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
        { provide: getModelToken(AssignedExercise), useValue: {} },
        { provide: getModelToken(AssignedSet), useValue: {} },
        { provide: getModelToken(Program), useValue: {} },
        { provide: getModelToken(InstructorClient), useValue: {} },
        { provide: getModelToken(User), useValue: {} },
        { provide: Sequelize, useValue: sequelize },
        { provide: NotificationService, useValue: { notify: jest.fn() } },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = module.get(ProgramAssignmentService);
  });

  describe('autoSkipPastWorkouts', () => {
    it('skips past never-started workouts and recomputes progress per assignment', async () => {
      assignedWorkoutModel.findAll.mockResolvedValue([
        { id: 'w1', programAssignmentId: 'a1' },
        { id: 'w2', programAssignmentId: 'a1' },
      ]);
      assignedWorkoutModel.update.mockResolvedValue([2]); // 2 rows skipped
      // _recomputeProgressForSkip: total then done
      assignedWorkoutModel.count
        .mockResolvedValueOnce(5)
        .mockResolvedValueOnce(2);
      assignmentModel.update.mockResolvedValue([1]);

      const result = await service.autoSkipPastWorkouts('2026-06-30');

      expect(result).toEqual({ skipped: 2, assignmentsTouched: 1 });
      expect(assignedWorkoutModel.update).toHaveBeenCalledWith(
        { status: WorkoutLogStatus.Skipped },
        expect.objectContaining({
          where: expect.objectContaining({ status: null }),
        }),
      );
      // progress recompute persisted
      expect(assignmentModel.update).toHaveBeenCalledWith(
        { completionPercent: 40 },
        expect.objectContaining({ where: { id: 'a1' } }),
      );
    });

    it('does nothing when no past workouts are pending', async () => {
      assignedWorkoutModel.findAll.mockResolvedValue([]);
      const result = await service.autoSkipPastWorkouts('2026-06-30');
      expect(result).toEqual({ skipped: 0, assignmentsTouched: 0 });
      expect(sequelize.transaction).not.toHaveBeenCalled();
    });
  });

  describe('autoCompleteAssignments', () => {
    it('completes an active assignment whose workouts are all done/skipped', async () => {
      assignmentModel.findAll.mockResolvedValue([{ id: 'a1' }]);
      // total=3, outstanding=0
      assignedWorkoutModel.count
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(0);
      assignmentModel.update.mockResolvedValue([1]);

      const result = await service.autoCompleteAssignments();

      expect(result).toEqual({ completed: 1 });
      expect(assignmentModel.update).toHaveBeenCalledWith(
        { status: 'COMPLETED', completionPercent: 100 },
        expect.objectContaining({
          where: { id: 'a1', status: { [Op.in]: ['ACTIVE', 'PENDING'] } },
        }),
      );
    });

    // A plan done before its start date is still done.
    it('looks at waiting plans as well as active ones', async () => {
      assignmentModel.findAll.mockResolvedValue([]);
      await service.autoCompleteAssignments();
      expect(assignmentModel.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: { [Op.in]: ['ACTIVE', 'PENDING'] } },
        }),
      );
    });

    it('leaves an assignment with outstanding workouts untouched', async () => {
      assignmentModel.findAll.mockResolvedValue([{ id: 'a1' }]);
      // total=3, outstanding=1 (a NULL / in-progress workout remains)
      assignedWorkoutModel.count
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(1);

      const result = await service.autoCompleteAssignments();

      expect(result).toEqual({ completed: 0 });
      expect(assignmentModel.update).not.toHaveBeenCalled();
    });

    it('does not count a re-run that flipped nothing', async () => {
      assignmentModel.findAll.mockResolvedValue([{ id: 'a1' }]);
      assignedWorkoutModel.count
        .mockResolvedValueOnce(3)
        .mockResolvedValueOnce(0);
      assignmentModel.update.mockResolvedValue([0]);

      await expect(service.autoCompleteAssignments()).resolves.toEqual({
        completed: 0,
      });
    });

    it('never completes a skeleton assignment (zero workouts)', async () => {
      assignmentModel.findAll.mockResolvedValue([{ id: 'a1' }]);
      assignedWorkoutModel.count
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(0);

      const result = await service.autoCompleteAssignments();

      expect(result).toEqual({ completed: 0 });
      expect(assignmentModel.update).not.toHaveBeenCalled();
    });
  });

  describe('completeIfFinished', () => {
    it('finishes the plan the moment nothing is left in it', async () => {
      assignmentModel.findOne.mockResolvedValue({ id: 'a1' });
      assignedWorkoutModel.count
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(0);
      assignmentModel.update.mockResolvedValue([1]);

      await expect(service.completeIfFinished('a1')).resolves.toBe(true);
      expect(assignmentModel.update).toHaveBeenCalledWith(
        { status: 'COMPLETED', completionPercent: 100 },
        expect.anything(),
      );
    });

    it('leaves a plan with workouts still to do', async () => {
      assignmentModel.findOne.mockResolvedValue({ id: 'a1' });
      assignedWorkoutModel.count
        .mockResolvedValueOnce(4)
        .mockResolvedValueOnce(1);

      await expect(service.completeIfFinished('a1')).resolves.toBe(false);
      expect(assignmentModel.update).not.toHaveBeenCalled();
    });

    it('leaves a paused, finished or cancelled plan alone', async () => {
      assignmentModel.findOne.mockResolvedValue(null);

      await expect(service.completeIfFinished('a1')).resolves.toBe(false);
      expect(assignmentModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'a1', status: { [Op.in]: ['ACTIVE', 'PENDING'] } },
        }),
      );
      expect(assignedWorkoutModel.count).not.toHaveBeenCalled();
    });
  });
});
