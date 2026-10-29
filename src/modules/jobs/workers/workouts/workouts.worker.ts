import { Inject } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { ProgramAssignmentService } from '../../../workout/program-assignment.service';
import { WorkoutLogService } from '../../../workout/workout-log.service';
import { JobContext } from '../../common/job-context';
import { JobHandler, MultiJobWorker } from '../../common/multi-job.worker';
import { QueueName } from '../../job-registry';

/**
 * Processor for the `workouts` queue. Three daily jobs, routed by name.
 * Thin handlers delegate to `ProgramAssignmentService` and
 * `WorkoutLogService` (where the transactional logic + progress
 * recompute live).
 */
@Processor(QueueName.Workouts)
export class WorkoutsWorker extends MultiJobWorker {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    logger: LoggerService,
    private readonly assignments: ProgramAssignmentService,
    private readonly workoutLogs: WorkoutLogService,
  ) {
    super(logger);
  }

  protected readonly handlers: Record<string, JobHandler> = {
    auto_skip_past_workouts: (_p, ctx) => this.autoSkipHandler(ctx),
    close_stale_workouts: (_p, ctx) => this.closeStaleHandler(ctx),
    auto_complete_assignments: (_p, ctx) => this.autoCompleteHandler(ctx),
  };

  private async autoSkipHandler(ctx: JobContext): Promise<void> {
    // `today` in DATEONLY space (YYYY-MM-DD), matching assigned_workout.scheduled_date.
    const today = new Date().toISOString().slice(0, 10);
    const r = await this.assignments.autoSkipPastWorkouts(today);
    ctx.log.log(
      `auto-skip skipped=${r.skipped} assignmentsTouched=${r.assignmentsTouched}`,
    );
  }

  private async closeStaleHandler(ctx: JobContext): Promise<void> {
    const r = await this.workoutLogs.closeStaleWorkouts();
    ctx.log.log(
      `close-stale completed=${r.completed} discarded=${r.discarded}`,
    );
  }

  private async autoCompleteHandler(ctx: JobContext): Promise<void> {
    const r = await this.assignments.autoCompleteAssignments();
    ctx.log.log(`auto-complete completed=${r.completed}`);
  }
}
