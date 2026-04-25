import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Sequelize } from 'sequelize-typescript';
import { Op, WhereOptions } from 'sequelize';
import { Session, type RecurringRule } from './entities/session.entity';
import { SessionParticipant } from './entities/session-participant.entity';
import { CreateSessionDto } from './dto/create-session.dto';
import { UpdateSessionDto } from './dto/update-session.dto';
import { buildPaginatedResponse } from '../../common/dto/pagination.dto';
import { buildSearchTerm } from '../../common/utils/search.utils';
import { UpdateParticipantStatusDto } from './dto/update-participant-status.dto';
import { User } from '../user/entities/user.entity';
import { GroupMember } from '../group/entities/group-member.entity';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import { EmailService } from '../../common/services/email.service';

/**
 * Session Service
 *
 * Manages training sessions and participant registrations.
 *
 * Visibility rules:
 * - PUBLIC: Anyone can view
 * - GROUP: Must be member of session.groupId
 * - CLIENTS: Must be client of session.instructorId (check instructor_client table)
 * - PRIVATE: Only the instructor can view
 *
 * TODO: [JOB SYSTEM] When Redis/Bull is configured:
 * - Automated status transitions: SCHEDULED → IN_PROGRESS → COMPLETED (based on scheduledAt + durationMinutes)
 * - Recurring session generation from recurringRule
 * - Session reminders (email/push) sent X hours before scheduledAt
 * - Auto-mark NO_SHOW for participants who don't check in
 */
@Injectable()
export class SessionService {
  // Cancellation policy: cannot leave within this many hours of session start
  private readonly CANCELLATION_CUTOFF_HOURS = 2;

  constructor(
    @InjectModel(Session)
    private sessionModel: typeof Session,
    @InjectModel(SessionParticipant)
    private participantModel: typeof SessionParticipant,
    @InjectModel(GroupMember)
    private memberModel: typeof GroupMember,
    @InjectModel(InstructorClient)
    private instructorClientModel: typeof InstructorClient,
    private sequelize: Sequelize,
    private emailService: EmailService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // =====================================================
  // SESSION CRUD
  // =====================================================

  /**
   * Create a new session
   */
  async create(
    userId: string,
    dto: CreateSessionDto,
  ): Promise<
    Record<string, unknown> & {
      warning?: string;
      conflictingSessionIds?: string[];
    }
  > {
    // If group-linked, verify user is a member of the group
    if (dto.groupId) {
      const isMember = await this.memberModel.findOne({
        where: {
          groupId: dto.groupId,
          userId: userId,
          leftAt: null,
        },
      });

      if (!isMember) {
        throw new ForbiddenException(
          'You must be a member of this group to create sessions',
        );
      }
    }

    // Check for scheduling conflicts (warning, not blocking)
    const { hasConflict, conflicts } = await this.checkConflicts(
      userId,
      new Date(dto.scheduledAt),
      dto.durationMinutes,
    );

    const session = await this.sessionModel.create({
      groupId: dto.groupId,
      instructorId: userId,
      title: dto.title,
      description: dto.description,
      sessionType: dto.sessionType,
      visibility: dto.visibility || 'GROUP',
      scheduledAt: dto.scheduledAt,
      durationMinutes: dto.durationMinutes,
      location: dto.location,
      maxParticipants: dto.maxParticipants,
      price: dto.price,
      currency: dto.currency || 'RON',
      status: dto.status || 'SCHEDULED',
      isRecurring: dto.isRecurring ?? false,
      recurringRule: dto.recurringRule ?? null,
    });

    this.logger.log(
      `Session created: "${session.title}" by user ${userId}`,
      'SessionService',
    );

    // Return session with conflict warning if applicable
    const result: Record<string, unknown> = session.toJSON();
    if (hasConflict) {
      result.warning = `Schedule conflict with ${conflicts.length} existing session(s)`;
      result.conflictingSessionIds = conflicts.map((c) => c.id);
    }

    return result;
  }

  /**
   * Get sessions visible to the user (paginated, deduplicated)
   */
  async getMySessions(userId: string, page: number = 1, limit: number = 20) {
    // Batch-load membership, registration, and client data in parallel
    const [memberships, registrations, clientRelationships] = await Promise.all(
      [
        this.memberModel.findAll({
          where: { userId, leftAt: null },
          attributes: ['groupId'],
        }),
        this.participantModel.findAll({
          where: { userId, status: { [Op.ne]: 'CANCELLED' } },
          attributes: ['sessionId'],
        }),
        this.instructorClientModel.findAll({
          where: { clientId: userId, status: 'ACTIVE' },
          attributes: ['instructorId'],
        }),
      ],
    );

    const groupIds = memberships.map((m) => m.groupId);
    const registeredSessionIds = registrations.map((r) => r.sessionId);
    const clientOfInstructorIds = clientRelationships.map(
      (r) => r.instructorId,
    );

    const offset = (page - 1) * limit;

    const whereClause = {
      [Op.or]: [
        { instructorId: userId },
        ...(groupIds.length > 0
          ? [
              {
                groupId: { [Op.in]: groupIds },
                visibility: { [Op.in]: ['GROUP', 'PUBLIC'] },
              },
            ]
          : []),
        ...(clientOfInstructorIds.length > 0
          ? [
              {
                instructorId: { [Op.in]: clientOfInstructorIds },
                visibility: 'CLIENTS',
              },
            ]
          : []),
        ...(registeredSessionIds.length > 0
          ? [{ id: { [Op.in]: registeredSessionIds } }]
          : []),
        { visibility: 'PUBLIC' },
      ],
    };

    const { rows: sessions, count: totalItems } =
      await this.sessionModel.findAndCountAll({
        where: whereClause,
        include: [
          {
            model: User,
            as: 'instructor',
            attributes: ['id', 'firstName', 'lastName', 'avatarId'],
          },
        ],
        order: [['scheduledAt', 'ASC']],
        limit,
        offset,
        distinct: true,
      });

    const seen = new Set<string>();
    const uniqueSessions = sessions.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

    return buildPaginatedResponse(uniqueSessions, totalItems, page, limit);
  }

  /**
   * Discover public sessions with advanced filters.
   */
  async discoverSessions(
    page: number = 1,
    limit: number = 20,
    filters?: {
      search?: string;
      sessionType?: string;
      dateFrom?: string;
      dateTo?: string;
      maxDurationMinutes?: number;
      sortBy?: string;
      sortDir?: 'ASC' | 'DESC';
    },
  ) {
    const offset = (page - 1) * limit;

    // Build the scheduledAt range constraint up-front so we don't have
    // to mutate a typed where clause field-by-field below.
    //
    // Cap the effective range at 180 days. Two attack shapes to block:
    //   1. dateFrom=1900-01-01 & dateTo=2100-01-01  → huge explicit span.
    //   2. dateFrom=1900-01-01 & dateTo omitted     → unbounded on the
    //      lower side (to=now, so ~126-year span backwards).
    // The implicit upper bound when dateTo is absent is `now`, so we
    // check `from` against whichever upper bound we'll actually pass to
    // the query.
    const MAX_RANGE_MS = 180 * 24 * 60 * 60 * 1000;
    const now = new Date();
    const from = filters?.dateFrom ? new Date(filters.dateFrom) : now;
    const to = filters?.dateTo ? new Date(filters.dateTo) : null;
    const effectiveUpper = to ?? now;
    if (effectiveUpper.getTime() - from.getTime() > MAX_RANGE_MS) {
      throw new BadRequestException(
        'Date range cannot exceed 180 days. Please narrow your search.',
      );
    }
    const scheduledAt: { [Op.gte]?: Date; [Op.lte]?: Date } = {
      [Op.gte]: from,
    };
    if (to) {
      scheduledAt[Op.lte] = to;
    }

    const term = filters?.search ? buildSearchTerm(filters.search) : null;
    const where: WhereOptions<Session> = {
      visibility: 'PUBLIC',
      status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS'] },
      scheduledAt,
      ...(filters?.sessionType && { sessionType: filters.sessionType }),
      ...(filters?.maxDurationMinutes && {
        durationMinutes: { [Op.lte]: filters.maxDurationMinutes },
      }),
      ...(term && {
        [Op.or]: [
          { title: { [Op.iLike]: term } },
          { description: { [Op.iLike]: term } },
          { location: { [Op.iLike]: term } },
        ],
      }),
    };

    const sortField = filters?.sortBy || 'scheduledAt';
    const sortDir = filters?.sortDir || 'ASC';

    const { rows: data, count: totalItems } =
      await this.sessionModel.findAndCountAll({
        where,
        include: [
          {
            model: User,
            as: 'instructor',
            attributes: ['id', 'firstName', 'lastName', 'avatarId'],
          },
        ],
        order: [[sortField, sortDir]],
        limit,
        offset,
        distinct: true,
      });

    return buildPaginatedResponse(data, totalItems, page, limit);
  }

  /**
   * Get a single session by ID
   */
  async getById(sessionId: string, userId: string): Promise<Session> {
    const session = await this.sessionModel.findByPk(sessionId, {
      include: [
        {
          model: User,
          as: 'instructor',
          attributes: ['id', 'firstName', 'lastName', 'avatarId'],
        },
        {
          model: SessionParticipant,
          include: [
            {
              model: User,
              attributes: ['id', 'firstName', 'lastName', 'avatarId'],
            },
          ],
        },
      ],
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    await this.assertCanViewSession(session, userId);

    return session;
  }

  /**
   * Update a session (instructor only)
   */
  async update(
    sessionId: string,
    userId: string,
    dto: UpdateSessionDto,
  ): Promise<Session> {
    const session = await this.sessionModel.findByPk(sessionId, {
      include: [SessionParticipant],
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.instructorId !== userId) {
      throw new ForbiddenException(
        'Only the instructor can update this session',
      );
    }

    const oldStatus = session.status;
    await session.update(dto);

    // If session was cancelled, notify all registered participants
    // TODO: [JOB SYSTEM] Move email notifications to background job queue
    if (dto.status === 'CANCELLED' && oldStatus !== 'CANCELLED') {
      this.notifyParticipantsOfCancellation(session).catch((err) =>
        this.logger.error(
          `Failed to notify participants of cancellation: ${err.message}`,
          'SessionService',
        ),
      );
    }

    return session;
  }

  /**
   * Delete a session (soft delete, instructor only)
   *
   * Notifies all registered participants via email.
   */
  async delete(sessionId: string, userId: string): Promise<void> {
    const session = await this.sessionModel.findByPk(sessionId, {
      include: [
        {
          model: SessionParticipant,
          where: { status: { [Op.ne]: 'CANCELLED' } },
          required: false,
          include: [{ model: User, attributes: ['email', 'firstName'] }],
        },
      ],
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.instructorId !== userId) {
      throw new ForbiddenException(
        'Only the instructor can delete this session',
      );
    }

    // Notify participants before deleting
    // TODO: [JOB SYSTEM] Move to background job queue
    this.notifyParticipantsOfCancellation(session).catch((err) =>
      this.logger.error(
        `Failed to notify participants of deletion: ${err.message}`,
        'SessionService',
      ),
    );

    await session.destroy(); // Soft delete (paranoid: true)

    this.logger.log(
      `Session deleted: "${session.title}" by user ${userId}`,
      'SessionService',
    );
  }

  /**
   * Clone/duplicate a session
   *
   * Creates a copy of the session with a new date.
   */
  async cloneSession(
    sessionId: string,
    userId: string,
    newScheduledAt: string,
  ): Promise<Session> {
    const original = await this.sessionModel.findByPk(sessionId);

    if (!original) {
      throw new NotFoundException('Session not found');
    }

    if (original.instructorId !== userId) {
      throw new ForbiddenException(
        'Only the instructor can clone this session',
      );
    }

    const cloned = await this.sessionModel.create({
      groupId: original.groupId,
      instructorId: userId,
      title: original.title,
      description: original.description,
      sessionType: original.sessionType,
      visibility: original.visibility,
      scheduledAt: newScheduledAt,
      durationMinutes: original.durationMinutes,
      location: original.location,
      maxParticipants: original.maxParticipants,
      price: original.price,
      currency: original.currency,
      status: 'SCHEDULED',
    });

    this.logger.log(
      `Session cloned: "${cloned.title}" from ${sessionId}`,
      'SessionService',
    );

    return cloned;
  }

  // =====================================================
  // RESCHEDULE & CONFLICT DETECTION
  // =====================================================

  /**
   * Reschedule a session (instructor only).
   * Updates scheduledAt and notifies all active participants.
   */
  async rescheduleSession(
    sessionId: string,
    userId: string,
    newScheduledAt: string,
    reason?: string,
  ): Promise<Session> {
    const session = await this.sessionModel.findByPk(sessionId, {
      include: [
        {
          model: SessionParticipant,
          where: { status: { [Op.ne]: 'CANCELLED' } },
          required: false,
          include: [{ model: User, attributes: ['email', 'firstName'] }],
        },
      ],
    });

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    if (session.instructorId !== userId) {
      throw new ForbiddenException(
        'Only the instructor can reschedule this session',
      );
    }

    if (['COMPLETED', 'CANCELLED'].includes(session.status)) {
      throw new BadRequestException(
        'Cannot reschedule a completed or cancelled session',
      );
    }

    const oldScheduledAt = session.scheduledAt;
    await session.update({ scheduledAt: newScheduledAt });

    // Notify participants (fire-and-forget)
    const activeParticipants = (session.participants || []).filter(
      (p) => !['CANCELLED', 'NO_SHOW'].includes(p.status),
    );

    for (const participant of activeParticipants) {
      if (participant.user?.email) {
        // TODO: Create dedicated reschedule email template
        this.logger.log(
          `[RESCHEDULE] Notify ${participant.user.email}: "${session.title}" moved from ${oldScheduledAt} to ${newScheduledAt}${reason ? ` — ${reason}` : ''}`,
          'SessionService',
        );
      }
    }

    this.logger.log(
      `Session "${session.title}" rescheduled from ${oldScheduledAt} to ${newScheduledAt}`,
      'SessionService',
    );

    return session;
  }

  /**
   * Check for scheduling conflicts for an instructor.
   * Returns overlapping sessions if any exist.
   */
  async checkConflicts(
    instructorId: string,
    scheduledAt: Date,
    durationMinutes: number,
    excludeSessionId?: string,
  ): Promise<{ hasConflict: boolean; conflicts: Session[] }> {
    const startTime = new Date(scheduledAt);
    const endTime = new Date(startTime.getTime() + durationMinutes * 60000);

    const where: WhereOptions<Session> = {
      instructorId,
      status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS'] },
      ...(excludeSessionId && { id: { [Op.ne]: excludeSessionId } }),
    };

    const sessions = await this.sessionModel.findAll({ where });

    const conflicts = sessions.filter((s) => {
      const sStart = new Date(s.scheduledAt);
      const sEnd = new Date(sStart.getTime() + s.durationMinutes * 60000);
      return sStart < endTime && sEnd > startTime;
    });

    return { hasConflict: conflicts.length > 0, conflicts };
  }

  /**
   * Calendar view: sessions grouped by date for a date range.
   */
  async getCalendar(
    userId: string,
    startDate: string,
    endDate: string,
  ): Promise<Record<string, Session[]>> {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const [memberships, registrations, clientRelationships] = await Promise.all(
      [
        this.memberModel.findAll({
          where: { userId, leftAt: null },
          attributes: ['groupId'],
        }),
        this.participantModel.findAll({
          where: { userId, status: { [Op.ne]: 'CANCELLED' } },
          attributes: ['sessionId'],
        }),
        this.instructorClientModel.findAll({
          where: { clientId: userId, status: 'ACTIVE' },
          attributes: ['instructorId'],
        }),
      ],
    );

    const groupIds = memberships.map((m) => m.groupId);
    const registeredSessionIds = registrations.map((r) => r.sessionId);
    const clientOfInstructorIds = clientRelationships.map(
      (r) => r.instructorId,
    );

    const whereClause = {
      scheduledAt: { [Op.gte]: start, [Op.lte]: end },
      [Op.or]: [
        { instructorId: userId },
        ...(groupIds.length > 0
          ? [
              {
                groupId: { [Op.in]: groupIds },
                visibility: { [Op.in]: ['GROUP', 'PUBLIC'] },
              },
            ]
          : []),
        ...(clientOfInstructorIds.length > 0
          ? [
              {
                instructorId: { [Op.in]: clientOfInstructorIds },
                visibility: 'CLIENTS',
              },
            ]
          : []),
        ...(registeredSessionIds.length > 0
          ? [{ id: { [Op.in]: registeredSessionIds } }]
          : []),
        { visibility: 'PUBLIC' },
      ],
    };

    const sessions = await this.sessionModel.findAll({
      where: whereClause,
      include: [
        {
          model: User,
          as: 'instructor',
          attributes: ['id', 'firstName', 'lastName', 'avatarId'],
        },
      ],
      order: [['scheduledAt', 'ASC']],
    });

    const calendar: Record<string, Session[]> = {};
    const seen = new Set<string>();

    for (const session of sessions) {
      if (seen.has(session.id)) continue;
      seen.add(session.id);

      const dateKey = new Date(session.scheduledAt).toISOString().split('T')[0];
      if (!calendar[dateKey]) {
        calendar[dateKey] = [];
      }
      calendar[dateKey].push(session);
    }

    return calendar;
  }

  // =====================================================
  // RECURRING SESSIONS
  // =====================================================

  /**
   * Preview recurrence: return list of upcoming occurrence dates for the next N weeks.
   * Used by the frontend to show a calendar. Includes the template session's date.
   */
  async getRecurrencePreview(
    sessionId: string,
    userId: string,
    weeks: number = 12,
  ): Promise<{ dates: string[] }> {
    const session = await this.sessionModel.findByPk(sessionId);
    if (!session) throw new NotFoundException('Session not found');
    if (session.instructorId !== userId)
      throw new ForbiddenException(
        'Only the instructor can preview recurrence',
      );
    if (!session.isRecurring || !session.recurringRule)
      throw new BadRequestException('Session is not recurring or has no rule');

    const rule = session.recurringRule;
    const firstAt = new Date(session.scheduledAt);
    const dates = this.computeOccurrenceDates(firstAt, rule, weeks, true);
    return { dates: dates.map((d) => d.toISOString()) };
  }

  /**
   * Generate upcoming session instances from a recurring template.
   * Creates new Session rows for each occurrence in the next N weeks (respecting endDate/endAfterOccurrences).
   * Skips dates that already have a session (same instructor, same title, same scheduledAt date).
   */
  async generateUpcomingInstances(
    sessionId: string,
    userId: string,
    weeks: number = 12,
  ): Promise<{ created: number; sessions: Session[] }> {
    const template = await this.sessionModel.findByPk(sessionId);
    if (!template) throw new NotFoundException('Session not found');
    if (template.instructorId !== userId)
      throw new ForbiddenException(
        'Only the instructor can generate instances',
      );
    if (!template.isRecurring || !template.recurringRule)
      throw new BadRequestException('Session is not recurring or has no rule');

    const rule = template.recurringRule;
    const firstAt = new Date(template.scheduledAt);
    // Exclude the first occurrence (it's the template itself)
    const occurrenceDates = this.computeOccurrenceDates(
      firstAt,
      rule,
      weeks,
      false,
    );

    // Find existing sessions for this template (same instructor, same title, same date)
    const existingStarts = new Set<string>();
    const existing = await this.sessionModel.findAll({
      where: {
        instructorId: userId,
        title: template.title,
        scheduledAt: {
          [Op.gte]: firstAt,
          [Op.lte]: new Date(
            firstAt.getTime() + weeks * 7 * 24 * 60 * 60 * 1000,
          ),
        },
      },
      attributes: ['scheduledAt'],
    });
    existing.forEach((s) =>
      existingStarts.add(new Date(s.scheduledAt).toISOString()),
    );

    const toCreate = occurrenceDates.filter(
      (d) => !existingStarts.has(d.toISOString()),
    );

    const created: Session[] = [];
    for (const scheduledAt of toCreate) {
      const session = await this.sessionModel.create({
        groupId: template.groupId,
        instructorId: template.instructorId,
        title: template.title,
        description: template.description,
        sessionType: template.sessionType,
        visibility: template.visibility,
        scheduledAt,
        durationMinutes: template.durationMinutes,
        location: template.location,
        maxParticipants: template.maxParticipants,
        price: template.price,
        currency: template.currency,
        status: 'SCHEDULED',
        isRecurring: false,
        recurringRule: null,
      });
      created.push(session);
    }

    this.logger.log(
      `Generated ${created.length} instances for recurring session "${template.title}"`,
      'SessionService',
    );

    return { created: created.length, sessions: created };
  }

  /**
   * Compute occurrence dates for a recurring rule.
   * @param firstAt First occurrence (template session start).
   * @param includeFirst If true, include firstAt in the list; if false, only dates after firstAt.
   */
  private computeOccurrenceDates(
    firstAt: Date,
    rule: RecurringRule,
    maxWeeks: number,
    includeFirst: boolean,
  ): Date[] {
    const interval = rule.interval ?? 1;
    const endDate = rule.endDate ? new Date(rule.endDate) : null;
    const endAfter = rule.endAfterOccurrences ?? null;
    const setTimeFromFirst = (d: Date) => {
      d.setHours(
        firstAt.getHours(),
        firstAt.getMinutes(),
        firstAt.getSeconds(),
        0,
      );
    };

    const results: Date[] = [];
    const push = (d: Date) => {
      if (endDate && d > endDate) return;
      if (endAfter && results.length >= endAfter) return;
      results.push(d);
    };

    if (rule.frequency === 'DAILY') {
      const d = new Date(firstAt);
      if (!includeFirst) d.setDate(d.getDate() + interval);
      while (
        results.length < maxWeeks * 7 &&
        (!endAfter || results.length < endAfter)
      ) {
        if (endDate && d > endDate) break;
        push(new Date(d.getTime()));
        d.setDate(d.getDate() + interval);
      }
      return results;
    }

    if (rule.frequency === 'MONTHLY') {
      const d = new Date(firstAt);
      if (!includeFirst) d.setMonth(d.getMonth() + interval);
      while (
        results.length < maxWeeks * 4 &&
        (!endAfter || results.length < endAfter)
      ) {
        if (endDate && d > endDate) break;
        push(new Date(d.getTime()));
        d.setMonth(d.getMonth() + interval);
      }
      return results;
    }

    // WEEKLY: daysOfWeek 0=Sun .. 6=Sat
    const daysOfWeek = rule.daysOfWeek?.length
      ? rule.daysOfWeek
      : [firstAt.getDay()];
    const weekStart = new Date(firstAt);
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());

    for (let w = 0; w < maxWeeks; w++) {
      const base = new Date(weekStart);
      base.setDate(base.getDate() + w * 7 * interval);
      for (const day of daysOfWeek) {
        const occ = new Date(base);
        occ.setDate(occ.getDate() + day);
        setTimeFromFirst(occ);
        if (occ <= firstAt && !includeFirst) continue;
        if (includeFirst && occ.getTime() === firstAt.getTime()) {
          push(occ);
          continue;
        }
        if (!includeFirst && occ <= firstAt) continue;
        if (endDate && occ > endDate) continue;
        if (endAfter && results.length >= endAfter) return results;
        push(occ);
      }
    }
    return results;
  }

  // =====================================================
  // PARTICIPANT MANAGEMENT
  // =====================================================

  /**
   * Join a session (register as participant)
   */
  async joinSession(
    sessionId: string,
    userId: string,
  ): Promise<SessionParticipant> {
    // Pre-check: load session for visibility assertion (outside transaction)
    const sessionCheck = await this.sessionModel.findByPk(sessionId);
    if (!sessionCheck) {
      throw new NotFoundException('Session not found');
    }

    // Guard: cannot join DRAFT sessions
    if (sessionCheck.status === 'DRAFT') {
      throw new BadRequestException('Session is not published yet');
    }

    await this.assertCanViewSession(sessionCheck, userId);

    if (sessionCheck.instructorId === userId) {
      throw new BadRequestException('You cannot join your own session');
    }

    // Use transaction with pessimistic locking to prevent capacity race conditions
    const transaction = await this.sequelize.transaction();
    try {
      // Re-load session with FOR UPDATE lock to prevent concurrent joins exceeding capacity
      const session = await this.sessionModel.findByPk(sessionId, {
        include: [SessionParticipant],
        lock: transaction.LOCK.UPDATE,
        transaction,
      });

      if (!session) {
        await transaction.rollback();
        throw new NotFoundException('Session not found');
      }

      const existing = await this.participantModel.findOne({
        where: { sessionId, userId },
        transaction,
      });

      if (existing && existing.status !== 'CANCELLED') {
        await transaction.rollback();
        throw new BadRequestException(
          'You are already registered for this session',
        );
      }

      // Check capacity under lock
      if (session.maxParticipants) {
        const activeCount = session.participants.filter(
          (p) => !['CANCELLED', 'NO_SHOW'].includes(p.status),
        ).length;

        if (activeCount >= session.maxParticipants) {
          await transaction.rollback();
          throw new BadRequestException('Session is full');
        }
      }

      let participant: SessionParticipant;

      // If previously cancelled, reactivate
      if (existing && existing.status === 'CANCELLED') {
        await existing.update(
          { status: 'REGISTERED', checkedInAt: null },
          { transaction },
        );
        participant = existing;
      } else {
        participant = await this.participantModel.create(
          { sessionId, userId, status: 'REGISTERED' },
          { transaction },
        );
      }

      await transaction.commit();

      // Notify instructor (fire-and-forget, outside transaction)
      this.notifyInstructorOfJoinLeave(session, userId, 'joined').catch(
        () => {},
      );

      return participant;
    } catch (error) {
      // Only rollback if transaction hasn't been committed or rolled back already
      try {
        await transaction.rollback();
      } catch {}
      throw error;
    }
  }

  /**
   * Leave a session (cancel registration)
   *
   * Enforces cancellation policy: cannot leave within CANCELLATION_CUTOFF_HOURS of session start.
   */
  async leaveSession(sessionId: string, userId: string): Promise<void> {
    const transaction = await this.sequelize.transaction();
    try {
      const session = await this.sessionModel.findByPk(sessionId, {
        transaction,
      });

      if (!session) {
        await transaction.rollback();
        throw new NotFoundException('Session not found');
      }

      const participant = await this.participantModel.findOne({
        where: {
          sessionId,
          userId,
          status: { [Op.ne]: 'CANCELLED' },
        },
        transaction,
      });

      if (!participant) {
        await transaction.rollback();
        throw new NotFoundException('You are not registered for this session');
      }

      // Cancellation policy check
      const now = new Date();
      const sessionStart = new Date(session.scheduledAt);
      const cutoffTime = new Date(
        sessionStart.getTime() -
          this.CANCELLATION_CUTOFF_HOURS * 60 * 60 * 1000,
      );

      if (now > cutoffTime) {
        await transaction.rollback();
        throw new BadRequestException(
          `Cannot cancel within ${this.CANCELLATION_CUTOFF_HOURS} hours of session start time`,
        );
      }

      await participant.update({ status: 'CANCELLED' }, { transaction });
      await transaction.commit();

      // Notify instructor (fire-and-forget, outside transaction).
      // Log on failure — silent drop buries real notification bugs.
      this.notifyInstructorOfJoinLeave(session, userId, 'left').catch(
        (err: unknown) =>
          this.logger.warn(
            `Failed to notify instructor of leave: ${(err as Error).message}`,
            'SessionService',
          ),
      );
    } catch (error) {
      try {
        await transaction.rollback();
      } catch {}
      throw error;
    }
  }

  /**
   * Confirm registration (participant confirms attendance)
   */
  async confirmRegistration(
    sessionId: string,
    userId: string,
  ): Promise<SessionParticipant> {
    const participant = await this.participantModel.findOne({
      where: {
        sessionId,
        userId,
        status: 'REGISTERED',
      },
    });

    if (!participant) {
      throw new NotFoundException(
        'No pending registration found for this session',
      );
    }

    await participant.update({ status: 'CONFIRMED' });

    return participant;
  }

  /**
   * Self check-in (participant checks themselves in)
   *
   * Only allowed within a window around the session start time.
   */
  async selfCheckIn(
    sessionId: string,
    userId: string,
  ): Promise<SessionParticipant> {
    const session = await this.sessionModel.findByPk(sessionId);

    if (!session) {
      throw new NotFoundException('Session not found');
    }

    const participant = await this.participantModel.findOne({
      where: {
        sessionId,
        userId,
        status: { [Op.in]: ['REGISTERED', 'CONFIRMED'] },
      },
    });

    if (!participant) {
      throw new NotFoundException('You are not registered for this session');
    }

    // Allow check-in 15 minutes before to 30 minutes after session start
    const now = new Date();
    const sessionStart = new Date(session.scheduledAt);
    const earliestCheckIn = new Date(sessionStart.getTime() - 15 * 60 * 1000);
    const latestCheckIn = new Date(sessionStart.getTime() + 30 * 60 * 1000);

    if (now < earliestCheckIn || now > latestCheckIn) {
      throw new BadRequestException(
        'Check-in is only available from 15 minutes before to 30 minutes after the session start',
      );
    }

    await participant.update({
      status: 'ATTENDED',
      checkedInAt: new Date(),
    });

    return participant;
  }

  /**
   * Update participant status (instructor only — e.g., check-in, mark attendance)
   */
  async updateParticipantStatus(
    sessionId: string,
    participantUserId: string,
    instructorUserId: string,
    dto: UpdateParticipantStatusDto,
  ): Promise<SessionParticipant> {
    const transaction = await this.sequelize.transaction();
    try {
      const session = await this.sessionModel.findByPk(sessionId, {
        transaction,
      });

      if (!session) {
        await transaction.rollback();
        throw new NotFoundException('Session not found');
      }

      if (session.instructorId !== instructorUserId) {
        await transaction.rollback();
        throw new ForbiddenException(
          'Only the instructor can update participant status',
        );
      }

      const participant = await this.participantModel.findOne({
        where: { sessionId, userId: participantUserId },
        include: [{ model: User, attributes: ['email', 'firstName'] }],
        transaction,
      });

      if (!participant) {
        await transaction.rollback();
        throw new NotFoundException('Participant not found');
      }

      const oldStatus = participant.status;
      const updateData: Partial<SessionParticipant> = { status: dto.status };

      // Auto-set checkedInAt when marking as ATTENDED
      if (dto.status === 'ATTENDED' && !participant.checkedInAt) {
        updateData.checkedInAt = new Date();
      }

      await participant.update(updateData, { transaction });
      await transaction.commit();

      // Notify participant of status change (fire-and-forget, outside transaction).
      if (oldStatus !== dto.status && participant.user) {
        this.emailService
          .sendParticipantStatusEmail(
            participant.user.email,
            participant.user.firstName,
            session.title,
            dto.status,
            session.scheduledAt,
          )
          .catch((err: unknown) =>
            this.logger.warn(
              `Failed to send participant-status email: ${(err as Error).message}`,
              'SessionService',
            ),
          );
      }

      return participant;
    } catch (error) {
      try {
        await transaction.rollback();
      } catch {}
      throw error;
    }
  }

  // =====================================================
  // NOTIFICATION HELPERS
  // =====================================================

  /**
   * Notify all registered participants of a session cancellation/deletion
   * TODO: [JOB SYSTEM] Move to background job with Bull queue for better reliability
   */
  private async notifyParticipantsOfCancellation(
    session: Session,
  ): Promise<void> {
    if (!session.participants || session.participants.length === 0) return;

    const activeParticipants = session.participants.filter(
      (p) => !['CANCELLED', 'NO_SHOW'].includes(p.status),
    );

    // Load instructor name for email template
    const instructor = await User.findByPk(session.instructorId, {
      attributes: ['firstName', 'lastName'],
    });
    const instructorName = instructor
      ? `${instructor.firstName} ${instructor.lastName}`
      : 'Your instructor';

    for (const participant of activeParticipants) {
      if (participant.user?.email) {
        this.emailService
          .sendSessionCancelledEmail(
            participant.user.email,
            participant.user.firstName,
            session.title,
            instructorName,
            session.scheduledAt,
          )
          .catch((err: unknown) =>
            this.logger.warn(
              `Failed to email session-cancel notice to ${participant.user?.email}: ${(err as Error).message}`,
              'SessionService',
            ),
          );
      }
    }

    this.logger.log(
      `Notified ${activeParticipants.length} participants of session cancellation: ${session.title}`,
      'SessionService',
    );
  }

  /**
   * Notify instructor when someone joins or leaves their session
   * TODO: [JOB SYSTEM] Move to background job
   */
  private async notifyInstructorOfJoinLeave(
    session: Session,
    participantUserId: string,
    action: 'joined' | 'left',
  ): Promise<void> {
    const instructor = await User.findByPk(session.instructorId, {
      attributes: ['email', 'firstName'],
    });
    const participant = await User.findByPk(participantUserId, {
      attributes: ['firstName', 'lastName'],
    });

    if (instructor && participant) {
      // TODO: Create a dedicated join/leave email template
      this.logger.log(
        `${participant.firstName} ${participant.lastName} ${action} session "${session.title}"`,
        'SessionService',
      );
    }
  }

  // =====================================================
  // HELPERS
  // =====================================================

  /**
   * Check if user can view a session based on visibility rules
   */
  private async assertCanViewSession(
    session: Session,
    userId: string,
  ): Promise<void> {
    if (session.instructorId === userId) return;
    if (session.visibility === 'PUBLIC') return;

    if (session.visibility === 'GROUP' && session.groupId) {
      const isMember = await this.memberModel.findOne({
        where: {
          groupId: session.groupId,
          userId: userId,
          leftAt: null,
        },
      });

      if (isMember) return;
    }

    // CLIENTS visibility: check if user is an active client of this instructor
    if (session.visibility === 'CLIENTS') {
      const isClient = await this.instructorClientModel.findOne({
        where: {
          instructorId: session.instructorId,
          clientId: userId,
          status: 'ACTIVE',
        },
        attributes: ['id'],
      });

      if (isClient) return;
    }

    const isParticipant = await this.participantModel.findOne({
      where: {
        sessionId: session.id,
        userId: userId,
        status: { [Op.ne]: 'CANCELLED' },
      },
    });

    if (isParticipant) return;

    throw new ForbiddenException('You do not have access to this session');
  }
}
