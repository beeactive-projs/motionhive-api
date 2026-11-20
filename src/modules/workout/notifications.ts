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
 *   - PLAN_PAUSED, PLAN_RESUMED → in-app + push
 *   - PLAN_FINISHED_BY_COACH, PLAN_CANCELLED → in-app + email + push
 *   - PLAN_ADJUSTED → in-app + push
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
  /** Null when the coach has no name yet: the message says "Your coach". */
  instructorName: string | null;
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

/** What every notice about a coach changing a client's plan carries. */
export interface PlanChangeForClient {
  clientId: string;
  assignmentId: string;
  programName: string;
  /** Null when the coach has no name yet: the message says "Your coach". */
  coachName: string | null;
  /** The coach's own words, quoted as written; null when they wrote none. */
  message: string | null;
}

/**
 * Every plan-change notice opens the plan itself: its page in the mobile
 * Workouts tab and the web plan detail, where the status card explains it.
 */
function planScreen(assignmentId: string) {
  return { screen: 'user/plans', entityId: assignmentId };
}

/**
 * The coach paused the client's plan. Its days wait: none is skipped while
 * it is paused, and resuming moves them forward.
 */
export function planPausedForClient(input: PlanChangeForClient): NotifyParams {
  return {
    userId: input.clientId,
    type: NotificationType.PLAN_PAUSED,
    message: {
      key: 'workout.planPaused',
      params: {
        coach: input.coachName,
        program: input.programName,
        note: input.message || null,
      },
    },
    data: planScreen(input.assignmentId),
  };
}

/**
 * The coach resumed the plan. Says how far the open days moved (whole
 * weeks, the same weekdays), zero when none had to.
 */
export function planResumedForClient(
  input: PlanChangeForClient & { weeksMoved: number },
): NotifyParams {
  return {
    userId: input.clientId,
    type: NotificationType.PLAN_RESUMED,
    message: {
      key: 'workout.planResumed',
      params: {
        coach: input.coachName,
        program: input.programName,
        weeks: input.weeksMoved,
        note: input.message || null,
      },
    },
    data: planScreen(input.assignmentId),
  };
}

/**
 * The coach marked the plan as finished before its last day. It stays in
 * the client's history as finished, at the percent actually done.
 */
export function planFinishedByCoachForClient(
  input: PlanChangeForClient & { percentDone: number },
): NotifyParams {
  return {
    userId: input.clientId,
    type: NotificationType.PLAN_FINISHED_BY_COACH,
    message: {
      key: 'workout.planFinishedByCoach',
      params: {
        coach: input.coachName,
        program: input.programName,
        percent: input.percentDone,
        note: input.message || null,
      },
    },
    data: planScreen(input.assignmentId),
  };
}

/**
 * The coach cancelled the plan: its days still to come leave the client's
 * calendar, and the workouts already finished stay in their history.
 */
export function planCancelledForClient(
  input: PlanChangeForClient & { workoutsDone: number },
): NotifyParams {
  return {
    userId: input.clientId,
    type: NotificationType.PLAN_CANCELLED,
    message: {
      key: 'workout.planCancelled',
      params: {
        coach: input.coachName,
        program: input.programName,
        done: input.workoutsDone,
        note: input.message || null,
      },
    },
    data: planScreen(input.assignmentId),
  };
}

/**
 * The coach changed the client's copy of their plan: one notice per
 * editing session (sent on Done), naming the first day that changed and
 * how many others did. The program the coach wrote stays as it was; only
 * this client's days changed.
 */
export function planAdjustedForClient(input: {
  clientId: string;
  assignmentId: string;
  programName: string;
  /** Null when the coach has no name yet: the message says "Your coach". */
  coachName: string | null;
  /** The first day that changed, as the client's plan names it. */
  dayName: string;
  /** Its week of the plan, counted from 1. */
  week: number;
  /** How many other days changed in the same session. */
  otherDays: number;
}): NotifyParams {
  return {
    userId: input.clientId,
    type: NotificationType.PLAN_ADJUSTED,
    message: {
      key: 'workout.planAdjusted',
      params: {
        coach: input.coachName,
        program: input.programName,
        day: input.dayName,
        week: input.week,
        others: input.otherDays,
      },
    },
    data: planScreen(input.assignmentId),
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
  /** Null when the client has no name yet: the message says "Your client". */
  clientName: string | null;
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
  /** Null when the client has no name yet: the message says "Your client". */
  clientName: string | null;
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

/**
 * A workout left open overnight was saved by the nightly job, at its last
 * ticked set. Told once, in the app, with the way to fix its duration.
 */
export function workoutAutoSavedForOwner(input: {
  ownerId: string;
  workoutLogId: string;
  workoutName: string;
}): NotifyParams {
  return {
    userId: input.ownerId,
    type: NotificationType.WORKOUT_AUTO_SAVED,
    message: {
      key: 'workout.workoutAutoSaved',
      params: { workout: input.workoutName },
    },
    data: {
      screen: 'user/workout-log',
      entityId: input.workoutLogId,
    },
  };
}
