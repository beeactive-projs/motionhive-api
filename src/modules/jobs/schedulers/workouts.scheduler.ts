import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { JobsService } from '../jobs.service';
import { bucketKey } from './sessions.scheduler';

/**
 * Cron triggers for the `workouts` queue. Enqueue only — no DB work,
 * no `setTimeout`. Skip-on-no-Redis is preserved (enqueue no-ops + logs).
 *
 * Auto-skip runs first (2:00), stale open workouts close next (2:15) and
 * auto-complete last (2:30), so a workout skipped or closed tonight can
 * complete its assignment in the same nightly pass. All are idempotent,
 * so the ordering is a nicety, not a correctness requirement.
 */
@Injectable()
export class WorkoutsScheduler {
  constructor(
    private readonly jobs: JobsService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async autoSkipPastWorkouts(): Promise<void> {
    const runKey = bucketKey(24 * 60 * 60_000);
    await this.jobs.enqueue(
      'workouts.auto_skip_past_workouts',
      { runKey },
      { jobId: `workouts.auto_skip_past_workouts-${runKey}` },
    );
  }

  // 02:15 — after auto-skip, before auto-complete.
  @Cron('0 15 2 * * *')
  async closeStaleWorkouts(): Promise<void> {
    const runKey = bucketKey(24 * 60 * 60_000);
    await this.jobs.enqueue(
      'workouts.close_stale_workouts',
      { runKey },
      { jobId: `workouts.close_stale_workouts-${runKey}` },
    );
  }

  // 02:30 — after auto-skip, so a same-day skip can complete the plan.
  @Cron('0 30 2 * * *')
  async autoCompleteAssignments(): Promise<void> {
    const runKey = bucketKey(24 * 60 * 60_000);
    await this.jobs.enqueue(
      'workouts.auto_complete_assignments',
      { runKey },
      { jobId: `workouts.auto_complete_assignments-${runKey}` },
    );
  }
}
