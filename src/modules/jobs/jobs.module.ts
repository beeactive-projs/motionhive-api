import { DynamicModule, Global, Module, Provider } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { NotificationModule } from '../notification/notification.module';
import { SessionModule } from '../session/session.module';
import { WorkoutModule } from '../workout/workout.module';
import { PaymentModule } from '../payment/payment.module';
import { AccountDeletionModule } from '../account-deletion/account-deletion.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { JobsService } from './jobs.service';
import { QUEUE_DEFAULTS, QueueName } from './job-registry';
import { NotificationsWorker } from './workers/notifications/notifications.worker';
import { SessionsWorker } from './workers/sessions/sessions.worker';
import { WorkoutsWorker } from './workers/workouts/workouts.worker';
import { PaymentsWorker } from './workers/payments/payments.worker';
import { MaintenanceWorker } from './workers/maintenance/maintenance.worker';
import { SessionsScheduler } from './schedulers/sessions.scheduler';
import { WorkoutsScheduler } from './schedulers/workouts.scheduler';
import { PaymentsScheduler } from './schedulers/payments.scheduler';
import { MaintenanceScheduler } from './schedulers/maintenance.scheduler';

/**
 * JobsModule — the producer-facing API + queue workers.
 *
 * @Global because every feature module that enqueues work injects
 * `JobsService`; marking it global avoids adding JobsModule to every
 * feature module's imports.
 *
 * **Why a dynamic `register()` (not a static @Module):**
 * worker registration must agree with the conditional
 * `BullModule.forRoot` in app.module.ts — both key off `REDIS_HOST`.
 * app.module reads `process.env.REDIS_HOST` *inside its imports array*,
 * which runs **after** `ConfigModule.forRoot()` has loaded `.env`. A
 * static `@Module` here would fix its providers at import time —
 * **before** `.env` is loaded — so a `REDIS_HOST` that lives only in
 * `.env` would be invisible and the two decisions would disagree
 * (queues registered, workers not → jobs never processed). `register()`
 * reads `process.env` at the same point app.module does, keeping them
 * in lockstep.
 *
 * **Skip-on-no-Redis (load-bearing):**
 *   - Queues are registered **unconditionally** — the BullQueue
 *     providers must exist (other wiring resolves their tokens) and
 *     `registerQueue` is inert without a `forRoot` connection.
 *   - `@Processor` workers attach a BullMQ Worker on construction,
 *     which throws "Worker requires a connection" when `forRoot` was
 *     skipped. So workers are registered **only when `REDIS_HOST` is
 *     set**.
 *   - `JobsService.enqueue` short-circuits to a no-op + warn when
 *     `REDIS_HOST` is unset, so producers/schedulers never touch a
 *     dead queue.
 * Net: the API boots fine without Redis; schedulers fire and log a
 * dropped-enqueue warning.
 *
 * To move workers to a separate dyno later, gate the worker providers
 * on a `WORKER_KIND` env flag inside `register()`.
 */
@Global()
@Module({})
export class JobsModule {
  static register(): DynamicModule {
    const redisEnabled = !!process.env.REDIS_HOST;

    // Schedulers fire @Cron jobs that query Postgres. On environments
    // that don't need periodic work (e.g. dev), set SCHEDULERS_ENABLED=
    // 'false' so the DB can scale to zero and not burn compute. Default
    // ON. Read here (call time) so it sees the loaded .env, like REDIS_HOST.
    const schedulersEnabled = process.env.SCHEDULERS_ENABLED !== 'false';

    const workerProviders: Provider[] = redisEnabled
      ? [
          NotificationsWorker,
          SessionsWorker,
          WorkoutsWorker,
          PaymentsWorker,
          MaintenanceWorker,
        ]
      : [];

    const schedulerProviders: Provider[] = schedulersEnabled
      ? [
          SessionsScheduler,
          WorkoutsScheduler,
          PaymentsScheduler,
          MaintenanceScheduler,
        ]
      : [];

    return {
      module: JobsModule,
      global: true,
      imports: [
        // Register every queue we use. Defaults come from job-registry.
        // Unconditional: inert without a forRoot connection, and the
        // BullQueue_* tokens must exist for the rest of the wiring.
        BullModule.registerQueue({
          name: QueueName.Notifications,
          defaultJobOptions:
            QUEUE_DEFAULTS[QueueName.Notifications].defaultJobOptions,
        }),
        BullModule.registerQueue({
          name: QueueName.Sessions,
          defaultJobOptions:
            QUEUE_DEFAULTS[QueueName.Sessions].defaultJobOptions,
        }),
        BullModule.registerQueue({
          name: QueueName.Workouts,
          defaultJobOptions:
            QUEUE_DEFAULTS[QueueName.Workouts].defaultJobOptions,
        }),
        BullModule.registerQueue({
          name: QueueName.Payments,
          defaultJobOptions:
            QUEUE_DEFAULTS[QueueName.Payments].defaultJobOptions,
        }),
        BullModule.registerQueue({
          name: QueueName.Maintenance,
          defaultJobOptions:
            QUEUE_DEFAULTS[QueueName.Maintenance].defaultJobOptions,
        }),
        // NotificationModule for the receipt + push delivery services
        // NotificationsWorker uses. Session/Workout/Payment modules export
        // the services their workers delegate to. One-way imports — JobsModule is @Global, so none
        // import it back (no cycle).
        NotificationModule,
        SessionModule,
        WorkoutModule,
        PaymentModule,
        MaintenanceModule,
        AccountDeletionModule,
      ],
      providers: [
        JobsService,
        // Schedulers only enqueue, but their @Cron-triggered jobs query
        // the DB — gated by SCHEDULERS_ENABLED so dev can keep Postgres
        // asleep. Default on (prod runs them).
        ...schedulerProviders,
        // Workers need a Redis connection at construction — gated.
        ...workerProviders,
        // EmailService comes in via the @Global EmailModule in AppModule.
      ],
      exports: [JobsService],
    };
  }
}
