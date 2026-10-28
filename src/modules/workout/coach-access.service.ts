import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, WhereOptions } from 'sequelize';

import { apiError } from '../../common/i18n';
import {
  InstructorClient,
  InstructorClientStatus,
} from '../client/entities/instructor-client.entity';
import { ProgramAssignment } from './entities/program-assignment.entity';
import { WorkoutLog } from './entities/workout-log.entity';
import { WorkoutVisibility } from './entities/workout.enums';

/**
 * CoachAccessService — the one place that decides how much of a
 * client's training a coach may read.
 *
 * Every coach read of a client's workouts goes through it: the log
 * history and log detail (WorkoutLogService) and the progress
 * aggregates (ProgressService). Keeping the rule here means the numbers
 * a coach sees can never be computed from logs the coach could not
 * open, and the two surfaces cannot drift apart.
 *
 * Two questions, always in this order:
 *   1. Is the caller this person's ACTIVE coach? Anything else is a 404.
 *   2. Which of the client's logs may they read? The ones from the
 *      coach's own plans (`visibleAssignmentIds`), plus any the client
 *      set to COACHES_ONLY or PUBLIC (`isReadableByCoach`). Every reader
 *      applies both halves; the assignment list alone is not the answer.
 */
@Injectable()
export class CoachAccessService {
  constructor(
    @InjectModel(InstructorClient)
    private readonly instructorClientModel: typeof InstructorClient,
    @InjectModel(ProgramAssignment)
    private readonly assignmentModel: typeof ProgramAssignment,
  ) {}

  /**
   * Asserts the caller is the ACTIVE instructor for clientId. 404 on
   * any other state — including PENDING and ARCHIVED — so we don't
   * leak the existence of a past or unconfirmed relationship.
   */
  async assertActiveCoachOf(
    instructorId: string,
    clientId: string,
  ): Promise<void> {
    const link = await this.instructorClientModel.findOne({
      where: {
        instructorId,
        clientId,
        status: InstructorClientStatus.ACTIVE,
      },
      attributes: ['id'],
    });
    if (!link) throw new NotFoundException(apiError('workout.clientNotFound'));
  }

  /**
   * The coach's own assignments with this client. A log from one of them
   * is readable whatever its level: the coach prescribed that work.
   *
   * Only half the rule; see `isReadableByCoach`. Freestyle sessions,
   * self-scheduled plans and other coaches' plans are readable only when
   * the client set them to COACHES_ONLY or PUBLIC. That per-workout level
   * replaced `program_assignment.share_off_plan` (migration 073), which
   * nothing could set.
   */
  async visibleAssignmentIds(
    instructorId: string,
    clientId: string,
  ): Promise<string[]> {
    const assignments = await this.assignmentModel.findAll({
      where: { instructorId, clientId, deletedAt: null },
      attributes: ['id'],
    });
    return assignments.map((a) => a.id);
  }

  /**
   * Both questions in one call: 404 unless the caller is the client's
   * ACTIVE coach, then their own assignment ids.
   */
  async readableAssignmentIds(
    instructorId: string,
    clientId: string,
  ): Promise<string[]> {
    await this.assertActiveCoachOf(instructorId, clientId);
    return this.visibleAssignmentIds(instructorId, clientId);
  }
}

/**
 * The whole rule for one log, given the coach's own assignment ids:
 * their plan, or the client shared it. Readers that filter in SQL apply
 * the same two conditions (`readableLogsWhere`, progress `_scopeFilter`).
 */
export function isReadableByCoach(
  log: Pick<WorkoutLog, 'programAssignmentId' | 'visibility'>,
  ownAssignmentIds: readonly string[],
): boolean {
  return (
    (!!log.programAssignmentId &&
      ownAssignmentIds.includes(log.programAssignmentId)) ||
    // Named, not "anything but ONLY_ME": a log read without its level
    // must stay closed, not open.
    SHARED_WITH_COACHES.includes(log.visibility)
  );
}

/** The levels a coach may read at; ONLY_ME, or nothing, is private. */
export const SHARED_WITH_COACHES: readonly WorkoutVisibility[] = [
  WorkoutVisibility.CoachesOnly,
  WorkoutVisibility.Public,
];

/** `isReadableByCoach` as a Sequelize `where` fragment for workout_log. */
export function readableLogsWhere(
  ownAssignmentIds: readonly string[],
): WhereOptions<WorkoutLog> {
  return {
    [Op.or]: [
      ...(ownAssignmentIds.length > 0
        ? [{ programAssignmentId: { [Op.in]: [...ownAssignmentIds] } }]
        : []),
      { visibility: { [Op.in]: [...SHARED_WITH_COACHES] } },
    ],
  };
}
