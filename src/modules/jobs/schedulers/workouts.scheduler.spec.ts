import { WorkoutsScheduler } from './workouts.scheduler';
import { JobsService } from '../jobs.service';
import { makeSilentLogger } from '../../../../test/helpers/sequelize-mocks';

describe('WorkoutsScheduler', () => {
  let scheduler: WorkoutsScheduler;
  let enqueue: jest.Mock;

  beforeEach(() => {
    enqueue = jest.fn().mockResolvedValue({ id: 'job-1' });
    const jobs = { enqueue } as unknown as JobsService;
    scheduler = new WorkoutsScheduler(jobs, makeSilentLogger());
  });

  it('autoSkipPastWorkouts enqueues workouts.auto_skip_past_workouts with deterministic jobId', async () => {
    await scheduler.autoSkipPastWorkouts();
    expect(enqueue).toHaveBeenCalledWith(
      'workouts.auto_skip_past_workouts',
      expect.objectContaining({ runKey: expect.any(String) }),
      expect.objectContaining({
        jobId: expect.stringMatching(
          /^workouts\.auto_skip_past_workouts-/,
        ) as string,
      }),
    );
  });

  it('closeStaleWorkouts enqueues workouts.close_stale_workouts', async () => {
    await scheduler.closeStaleWorkouts();
    expect(enqueue).toHaveBeenCalledWith(
      'workouts.close_stale_workouts',
      expect.any(Object),
      expect.objectContaining({
        jobId: expect.stringMatching(
          /^workouts\.close_stale_workouts-/,
        ) as string,
      }),
    );
  });

  it('autoCompleteAssignments enqueues workouts.auto_complete_assignments', async () => {
    await scheduler.autoCompleteAssignments();
    expect(enqueue).toHaveBeenCalledWith(
      'workouts.auto_complete_assignments',
      expect.any(Object),
      expect.objectContaining({
        jobId: expect.stringMatching(
          /^workouts\.auto_complete_assignments-/,
        ) as string,
      }),
    );
  });
});
