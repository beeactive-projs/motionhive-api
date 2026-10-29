import { Test } from '@nestjs/testing';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { UnrecoverableError } from 'bullmq';
import { WorkoutsWorker } from './workouts.worker';
import { ProgramAssignmentService } from '../../../workout/program-assignment.service';
import { WorkoutLogService } from '../../../workout/workout-log.service';
import { makeSilentLogger } from '../../../../../test/helpers/sequelize-mocks';

const fakeJob = (name: string) =>
  ({
    data: {},
    queueName: 'workouts',
    name,
    id: 'job-test',
    attemptsMade: 0,
  }) as unknown as Parameters<WorkoutsWorker['process']>[0];

describe('WorkoutsWorker', () => {
  let worker: WorkoutsWorker;
  let assignments: {
    autoSkipPastWorkouts: jest.Mock;
    autoCompleteAssignments: jest.Mock;
  };
  let workoutLogs: { closeStaleWorkouts: jest.Mock };

  beforeEach(async () => {
    assignments = {
      autoSkipPastWorkouts: jest
        .fn()
        .mockResolvedValue({ skipped: 1, assignmentsTouched: 1 }),
      autoCompleteAssignments: jest.fn().mockResolvedValue({ completed: 1 }),
    };
    workoutLogs = {
      closeStaleWorkouts: jest
        .fn()
        .mockResolvedValue({ completed: 1, discarded: 0 }),
    };

    const ref = await Test.createTestingModule({
      providers: [
        WorkoutsWorker,
        { provide: ProgramAssignmentService, useValue: assignments },
        { provide: WorkoutLogService, useValue: workoutLogs },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    worker = ref.get(WorkoutsWorker);
  });

  it('routes auto_skip_past_workouts → ProgramAssignmentService.autoSkipPastWorkouts with a YYYY-MM-DD date', async () => {
    await worker.process(fakeJob('auto_skip_past_workouts'));
    expect(assignments.autoSkipPastWorkouts).toHaveBeenCalledTimes(1);
    const arg = assignments.autoSkipPastWorkouts.mock.calls[0][0] as string;
    expect(arg).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('routes auto_complete_assignments → ProgramAssignmentService.autoCompleteAssignments', async () => {
    await worker.process(fakeJob('auto_complete_assignments'));
    expect(assignments.autoCompleteAssignments).toHaveBeenCalledTimes(1);
  });

  it('routes close_stale_workouts → WorkoutLogService.closeStaleWorkouts', async () => {
    await worker.process(fakeJob('close_stale_workouts'));
    expect(workoutLogs.closeStaleWorkouts).toHaveBeenCalledTimes(1);
  });

  it('unknown job name → UnrecoverableError', async () => {
    await expect(worker.process(fakeJob('bogus'))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});
