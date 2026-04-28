import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { literal, Op } from 'sequelize';
import { Session } from '../session/entities/session.entity';
import { SessionParticipant } from '../session/entities/session-participant.entity';
import { Group } from '../group/entities/group.entity';
import { GroupMember } from '../group/entities/group-member.entity';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import { User } from '../user/entities/user.entity';
import { InstructorProfile } from '../profile/entities/instructor-profile.entity';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Session)
    private readonly sessionModel: typeof Session,
    @InjectModel(SessionParticipant)
    private readonly participantModel: typeof SessionParticipant,
    @InjectModel(Group)
    private readonly groupModel: typeof Group,
    @InjectModel(GroupMember)
    private readonly memberModel: typeof GroupMember,
    @InjectModel(InstructorClient)
    private readonly clientModel: typeof InstructorClient,
    @InjectModel(User)
    private readonly userModel: typeof User,
  ) {}

  /**
   * Instructor summary: key metrics for the last 30 days.
   */
  async getInstructorSummary(instructorId: string) {
    // Verify user is an instructor
    const profile = await InstructorProfile.findOne({
      where: { userId: instructorId },
    });
    if (!profile) {
      throw new ForbiddenException('You are not an instructor');
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [
      totalSessions,
      completedSessions,
      cancelledSessions,
      totalClients,
      activeClients,
      groups,
    ] = await Promise.all([
      this.sessionModel.count({
        where: {
          instructorId,
          createdAt: { [Op.gte]: thirtyDaysAgo },
        },
      }),
      this.sessionModel.count({
        where: {
          instructorId,
          status: 'COMPLETED',
          createdAt: { [Op.gte]: thirtyDaysAgo },
        },
      }),
      this.sessionModel.count({
        where: {
          instructorId,
          status: 'CANCELLED',
          createdAt: { [Op.gte]: thirtyDaysAgo },
        },
      }),
      this.clientModel.count({
        where: { instructorId },
      }),
      this.clientModel.count({
        where: { instructorId, status: 'ACTIVE' },
      }),
      this.groupModel.findAll({
        where: { instructorId },
        attributes: {
          include: [
            'id',
            [
              literal(
                '(SELECT COUNT(*)::int FROM group_member WHERE group_member.group_id = "Group"."id" AND group_member.left_at IS NULL)',
              ),
              'memberCount',
            ],
          ],
        },
        paranoid: true,
      }),
    ]);

    // Calculate average attendance rate for completed sessions
    let averageAttendanceRate = 0;
    if (completedSessions > 0) {
      const completedSessionIds = (
        await this.sessionModel.findAll({
          where: {
            instructorId,
            status: 'COMPLETED',
            createdAt: { [Op.gte]: thirtyDaysAgo },
          },
          attributes: ['id'],
        })
      ).map((s) => s.id);

      if (completedSessionIds.length > 0) {
        const totalParticipants = await this.participantModel.count({
          where: {
            sessionId: { [Op.in]: completedSessionIds },
            status: {
              [Op.in]: ['ATTENDED', 'NO_SHOW', 'CONFIRMED', 'REGISTERED'],
            },
          },
        });

        const attended = await this.participantModel.count({
          where: {
            sessionId: { [Op.in]: completedSessionIds },
            status: 'ATTENDED',
          },
        });

        averageAttendanceRate =
          totalParticipants > 0
            ? Math.round((attended / totalParticipants) * 100) / 100
            : 0;
      }
    }

    // New clients in last 30 days
    const newClients = await this.clientModel.count({
      where: {
        instructorId,
        createdAt: { [Op.gte]: thirtyDaysAgo },
      },
    });

    // memberCount is a computed attribute (subquery on group_member), so
    // it isn't typed on the entity. Read it via getDataValue.
    const totalMembers = groups.reduce(
      (sum, g) => sum + (Number(g.getDataValue('memberCount' as never)) || 0),
      0,
    );

    return {
      period: 'last_30_days',
      sessions: {
        total: totalSessions,
        completed: completedSessions,
        cancelled: cancelledSessions,
        averageAttendanceRate,
      },
      clients: {
        total: totalClients,
        active: activeClients,
        new: newClients,
      },
      groups: {
        total: groups.length,
        totalMembers,
      },
    };
  }

  /**
   * User's own activity summary.
   */
  async getUserActivity(userId: string) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [sessionsAttended, sessionsRegistered, sessionsNoShow, groupCount] =
      await Promise.all([
        this.participantModel.count({
          where: {
            userId,
            status: 'ATTENDED',
            createdAt: { [Op.gte]: thirtyDaysAgo },
          },
        }),
        this.participantModel.count({
          where: {
            userId,
            status: { [Op.in]: ['REGISTERED', 'CONFIRMED'] },
            createdAt: { [Op.gte]: thirtyDaysAgo },
          },
        }),
        this.participantModel.count({
          where: {
            userId,
            status: 'NO_SHOW',
            createdAt: { [Op.gte]: thirtyDaysAgo },
          },
        }),
        this.memberModel.count({
          where: { userId, leftAt: null },
        }),
      ]);

    const attendanceRate =
      sessionsAttended + sessionsNoShow > 0
        ? Math.round(
            (sessionsAttended / (sessionsAttended + sessionsNoShow)) * 100,
          ) / 100
        : 0;

    return {
      period: 'last_30_days',
      sessions: {
        attended: sessionsAttended,
        upcoming: sessionsRegistered,
        noShow: sessionsNoShow,
        attendanceRate,
      },
      groups: {
        memberOf: groupCount,
      },
    };
  }

  /**
   * Platform-wide stats (admin only).
   */
  async getPlatformStats() {
    const [
      totalUsers,
      activeUsers,
      totalInstructors,
      totalGroups,
      totalSessions,
      completedSessions,
    ] = await Promise.all([
      this.userModel.count(),
      this.userModel.count({ where: { isActive: true } }),
      InstructorProfile.count(),
      this.groupModel.count(),
      this.sessionModel.count(),
      this.sessionModel.count({ where: { status: 'COMPLETED' } }),
    ]);

    return {
      users: { total: totalUsers, active: activeUsers },
      instructors: { total: totalInstructors },
      groups: { total: totalGroups },
      sessions: { total: totalSessions, completed: completedSessions },
    };
  }
}
