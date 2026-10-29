import type { NotifyParams } from '../notification/notification.service';
import { NotificationType } from '../notification/notification.service';
import { day } from '../../common/i18n';

/**
 * Notification builders for the workout module.
 *
 * Copy lives in the catalog (`notifications.workout.*` under
 * src/common/i18n/catalog).
 *
 * Builders take primitives — never Sequelize entities — so the
 * outbox can safely flush after the assignment tx commits without
 * triggering lazy-load explosions on dehydrated relations.
 *
 * Defaults (notification-defaults.ts):
 *   - PROGRAM_ASSIGNED → in-app + email
 *   - CLIENT_COMPLETED_WORKOUT → in-app only
 *   - CLIENT_COMPLETED_PLAN → in-app + email
 */

/**
 * The client just had a program assigned by their instructor.
 *
 * Click target: `/user/plans/:assignmentId` — the client's plan detail
 * (ClientPlanDetail). The route lives under /user/* after the IA
 * refactor; the old /my/plans path was never given a redirect so
 * navigating there does nothing.
 */
export function programAssignedForClient(input: {
  clientId: string;
  assignmentId: string;
  programName: string;
  startDate: string;
  instructorName: string;
}): NotifyParams {
  return {
    userId: input.clientId,
    type: NotificationType.PROGRAM_ASSIGNED,
    message: {
      key: 'workout.programAssigned',
      params: {
        coach: input.instructorName,
        program: input.programName,
        start: day(input.startDate),
      },
    },
    data: {
      screen: 'user/plans',
      entityId: input.assignmentId,
    },
  };
}

/**
 * A client finished a workout from a program their coach assigned.
 *
 * Without this the coaching loop never closes: someone trains, and
 * nothing reaches the person who wrote the plan. It was in the V1 scope
 * list and never got wired.
 *
 * Only fires for assigned work. Freestyle training is the client's own
 * business; sharing it (`workout_log.visibility`) lets a coach open it,
 * not get pinged about it.
 *
 * Click target: `/coaching/clients/:clientId` — that client's profile, which
 * lists their recent workouts and is where the replay opens from.
 *
 * Not the replay itself: that route is `/user/workout-log/:id/replay?coach=1`,
 * and a notification payload is `{screen, entityId}` joined as
 * `/<screen>/<entityId>` — it cannot express a segment *after* the id. Sending
 * the log id into `/coaching/clients/:id` (which is what this did) loaded the
 * client-profile page with a workout-log id and found nothing.
 */
export function clientCompletedWorkoutForInstructor(input: {
  instructorId: string;
  clientId: string;
  workoutLogId: string;
  clientName: string;
  workoutName: string;
  setsCompleted: number;
}): NotifyParams {
  return {
    userId: input.instructorId,
    type: NotificationType.CLIENT_COMPLETED_WORKOUT,
    message: {
      key: 'workout.clientCompletedWorkout',
      params: {
        client: input.clientName,
        workout: input.workoutName,
        sets: input.setsCompleted,
      },
    },
    data: {
      screen: 'coaching/clients',
      entityId: input.clientId,
    },
  };
}

/**
 * A client just finished every workout in a plan you assigned.
 *
 * Emailed as well as in-app, unlike the per-workout notification: this
 * happens a few times a year rather than several times a week, and it
 * is the moment the coach has something to do — debrief, and decide
 * what comes next.
 *
 * Click target: the client's profile, where the plan and its history
 * already live.
 */
export function clientCompletedPlanForInstructor(input: {
  instructorId: string;
  clientId: string;
  clientName: string;
  programName: string;
  workoutsCompleted: number;
}): NotifyParams {
  return {
    userId: input.instructorId,
    type: NotificationType.CLIENT_COMPLETED_PLAN,
    message: {
      key: 'workout.clientCompletedPlan',
      params: {
        client: input.clientName,
        program: input.programName,
        count: input.workoutsCompleted,
      },
    },
    data: {
      screen: 'coaching/clients',
      entityId: input.clientId,
    },
  };
}

/**
 * Staff took one of your workouts down after a report. Says which one and
 * why, the way a removal has to be explained to the person it affects.
 *
 * Click target: that workout's own page, where it now shows as Only me.
 */
export function workoutTakenDownForOwner(input: {
  ownerId: string;
  workoutLogId: string;
  workoutName: string;
  category: string;
}): NotifyParams {
  return {
    userId: input.ownerId,
    type: NotificationType.WORKOUT_TAKEN_DOWN,
    message: {
      key: 'workout.workoutTakenDown',
      params: { workout: input.workoutName, reason: input.category },
    },
    data: {
      screen: 'user/workout-log',
      entityId: input.workoutLogId,
    },
  };
}
