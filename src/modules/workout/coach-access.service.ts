import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import { apiError } from '../../common/i18n';
import {
  InstructorClient,
  InstructorClientStatus,
} from '../client/entities/instructor-client.entity';
import { ProgramAssignment } from './entities/program-assignment.entity';

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
 *   2. Which of the client's logs may they read? (`visibleAssignmentIds`)
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
   * Which of this client's logs this coach may read.
   *
   * Returns the coach's own assignment ids, or `null` meaning "no
   * restriction" when the client has opted in via `shareOffPlan` on any
   * of them. A log is readable when its `program_assignment_id` is in
   * the list, so freestyle sessions (no assignment), self-scheduled
   * plans and other coaches' plans all fall outside it. An empty list
   * means nothing is readable.
   *
   * `share_off_plan` has existed since migration 056, documented as the
   * client-owned toggle for whether a coach may see training logged
   * outside their plan, and defaulting to false — but nothing ever read
   * it, so every coach could read every freestyle session their client
   * logged, including its private note. Presence still leaks through
   * roster adherence (the coach can tell you trained); the content no
   * longer does.
   */
  async visibleAssignmentIds(
    instructorId: string,
    clientId: string,
  ): Promise<string[] | null> {
    const assignments = await this.assignmentModel.findAll({
      where: { instructorId, clientId, deletedAt: null },
      attributes: ['id', 'shareOffPlan'],
    });
    if (assignments.some((a) => a.shareOffPlan)) return null;
    return assignments.map((a) => a.id);
  }

  /**
   * Both questions in one call: 404 unless the caller is the client's
   * ACTIVE coach, then the allow-list from `visibleAssignmentIds`.
   */
  async readableAssignmentIds(
    instructorId: string,
    clientId: string,
  ): Promise<string[] | null> {
    await this.assertActiveCoachOf(instructorId, clientId);
    return this.visibleAssignmentIds(instructorId, clientId);
  }
}
