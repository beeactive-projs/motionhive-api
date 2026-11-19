import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op } from 'sequelize';
import {
  buildPaginatedResponse,
  getOffset,
  PaginatedResponse,
} from '../../../common/dto/pagination.dto';
import { apiError } from '../../../common/i18n';
import { User } from '../../user/entities/user.entity';
import { Venue } from '../../venue/entities/venue.entity';
import { SessionInstance } from '../entities/session-instance.entity';
import { SessionParticipant } from '../entities/session-participant.entity';
import { SessionTemplate } from '../entities/session-template.entity';
import {
  SessionInstanceStatus,
  SessionParticipantStatus,
} from '../entities/session.enums';
import { MySessionsQueryDto } from '../dto/my-sessions-query.dto';

/**
 * Client-facing utilities: my-bookings, counts, .ics, join-info.
 *
 * Efficiency rules (per master plan §0.3):
 *   - `counts` is FOUR small COUNT(*) queries fired in PARALLEL — never
 *     fetches a list to derive a count.
 *   - `my` runs ONE findAndCountAll with template + instructor eager-loaded.
 *   - `ics` reads one row with the joined template; no participants needed.
 *   - `joinInfo` reads one participant row with the joined instance+template.
 *     Confirmed-only. Time math is server-authoritative.
 */

const JOIN_BEFORE_START_MS = 5 * 60_000; // T-5min: link goes live
const JOIN_AFTER_START_MS = 15 * 60_000; // T+15min: link expires

const INSTRUCTOR_FIELDS = [
  'id',
  'firstName',
  'lastName',
  'avatarUrl',
  'handle',
] as const;
const VENUE_FIELDS = ['id', 'name', 'city', 'kind'] as const;

export interface MyCounts {
  upcoming: number;
  pendingApproval: number;
  waitlisted: number;
  past: number;
  cancelled: number;
}

export interface JoinInfo {
  meetingUrl: string;
  joinActiveFrom: Date;
  joinActiveUntil: Date;
  instructorJoined: boolean;
}

@Injectable()
export class SessionClientService {
  constructor(
    @InjectModel(SessionParticipant)
    private readonly participantModel: typeof SessionParticipant,
    @InjectModel(SessionInstance)
    private readonly instanceModel: typeof SessionInstance,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // ─── MY (paginated bookings) ──────────────────────────────────────

  async listMy(
    callerId: string,
    query: MySessionsQueryDto,
  ): Promise<PaginatedResponse<SessionParticipant>> {
    const tab = query.tab ?? 'upcoming';
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const where = this.buildTabWhere(callerId, tab);

    const { rows, count } = await this.participantModel.findAndCountAll({
      where,
      include: [
        {
          model: SessionInstance,
          as: 'instance', // matches @BelongsTo declaration on SessionParticipant
          required: true,
          where: this.buildInstanceFilterForTab(tab),
          include: [
            {
              model: SessionTemplate,
              as: 'template',
              required: true,
              attributes: [
                'id',
                'slug',
                'title',
                'type',
                'access',
                'locationKind',
                'meetingProvider',
                'durationMinutes',
                'capacity',
                'timezone',
                'priceAmountCents',
                'priceCurrency',
                'instructorId',
                'groupId',
              ],
            },
            {
              model: User,
              as: 'instructor',
              attributes: [...INSTRUCTOR_FIELDS],
              required: false,
            },
            {
              model: Venue,
              as: 'venueOverride',
              attributes: [...VENUE_FIELDS],
              required: false,
            },
          ],
        },
      ],
      // Privacy: never return private_note here. It's the instructor's
      // note. Same for snapshot meeting url — client gets it from
      // join-info when confirmed and within the time window.
      attributes: [
        'id',
        'userId',
        'instanceId',
        'status',
        'attended',
        'bookingNote',
        'bookedAt',
        'approvedAt',
        'cancelledAt',
        'cancelReason',
        'waitlistPosition',
        'snapshotPriceCents',
        'snapshotCurrency',
        'snapshotCancelCutoffH',
      ],
      order: [
        // upcoming/pendingApproval/waitlisted: ascending startAt;
        // past/cancelled: descending. Order through the JOIN alias —
        // ['instance', 'startAt', dir] resolves via Sequelize's
        // association-name resolution.
        [
          { model: SessionInstance, as: 'instance' },
          'startAt',
          this.orderForTab(tab),
        ],
      ],
      limit,
      offset: getOffset(page, limit),
      distinct: true,
    });

    return buildPaginatedResponse(rows, count, page, limit);
  }

  // ─── COUNTS (4 parallel COUNT(*) ──────────────────────────────────

  async counts(callerId: string): Promise<MyCounts> {
    // Run all five in parallel. Each is a single indexed query.
    const [upcoming, pendingApproval, waitlisted, past, cancelled] =
      await Promise.all([
        this.countTab(callerId, 'upcoming'),
        this.countTab(callerId, 'pendingApproval'),
        this.countTab(callerId, 'waitlisted'),
        this.countTab(callerId, 'past'),
        this.countTab(callerId, 'cancelled'),
      ]);
    return { upcoming, pendingApproval, waitlisted, past, cancelled };
  }

  private async countTab(
    userId: string,
    tab: 'upcoming' | 'pendingApproval' | 'waitlisted' | 'past' | 'cancelled',
  ): Promise<number> {
    return this.participantModel.count({
      where: this.buildTabWhere(userId, tab),
      include: [
        {
          model: SessionInstance,
          as: 'instance',
          required: true,
          where: this.buildInstanceFilterForTab(tab),
          attributes: [],
        },
      ],
      distinct: true,
      col: 'id',
    });
  }

  // ─── ICS (single VEVENT) ──────────────────────────────────────────

  /**
   * Generate the iCalendar payload for a session.
   *
   * AUDIT FIX (F-Bug 1, F-Bug 3):
   *   - Access-checked at the SERVICE layer (defense-in-depth in
   *     addition to whatever the controller adds). For gated sessions
   *     (CLIENTS_ONLY / GROUP_ONLY), the caller must be a non-terminal
   *     participant. For OPEN/FREE anyone authenticated may download.
   *   - The meeting URL is included ONLY when the caller is a confirmed
   *     participant of an ONLINE session. For non-participants of
   *     OPEN/FREE ONLINE sessions we include the LOCATION/instructor
   *     info but redact the URL.
   */
  async ics(callerId: string, instanceId: string): Promise<string> {
    const instance = await this.instanceModel.findOne({
      where: { id: instanceId },
      include: [
        {
          model: SessionTemplate,
          attributes: [
            'title',
            'description',
            'locationKind',
            'meetingUrl',
            'meetingProvider',
            'access',
          ],
          required: true,
        },
        {
          model: User,
          as: 'instructor',
          attributes: ['firstName', 'lastName', 'email'],
          required: false,
        },
        {
          model: Venue,
          as: 'venueOverride',
          attributes: ['name', 'city', 'line1', 'postalCode'],
          required: false,
        },
      ],
    });
    if (!instance) throw new NotFoundException(apiError('session.notFound'));

    // Look up caller's participant row (if any) — drives both access
    // and meeting-URL inclusion below.
    const participant = await this.participantModel.findOne({
      where: { instanceId, userId: callerId },
      attributes: ['status', 'snapshotMeetingUrl'],
    });
    const isParticipant =
      !!participant &&
      participant.status !== SessionParticipantStatus.Cancelled &&
      participant.status !== SessionParticipantStatus.Declined;
    const isConfirmed =
      participant?.status === SessionParticipantStatus.Confirmed;

    // Access gate: OPEN/FREE always allow .ics download; gated sessions
    // require an active participation row.
    const access = instance.template.access;
    const isOpenFree =
      access === 'OPEN' || access === 'FREE' || access === ('OPEN' as never);
    if (!isOpenFree && !isParticipant) {
      throw new NotFoundException(apiError('session.notFound'));
    }

    const title = instance.titleOverride ?? instance.template.title;
    const description =
      instance.descriptionOverride ?? instance.template.description ?? '';
    const status =
      instance.status === SessionInstanceStatus.Cancelled
        ? 'CANCELLED'
        : 'CONFIRMED';

    // Build VEVENT. Date format: YYYYMMDDTHHmmssZ (UTC).
    const fmt = (d: Date): string =>
      d
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}/, '');

    const lines: string[] = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//MotionHive//Sessions//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'BEGIN:VEVENT',
      `UID:session-${instance.id}@motionhive`,
      `DTSTAMP:${fmt(new Date())}`,
      `DTSTART:${fmt(instance.startAt)}`,
      `DTEND:${fmt(instance.endAt)}`,
      `SUMMARY:${this.escapeIcs(title)}`,
      `STATUS:${status}`,
      `LAST-MODIFIED:${fmt(instance.updatedAt)}`,
    ];

    if (description) {
      lines.push(`DESCRIPTION:${this.escapeIcs(description)}`);
    }

    // Location: prefer the override venue address, fall back to template venue.
    const venue = instance.venueOverride;
    if (venue) {
      const parts = [venue.name, venue.line1, venue.postalCode, venue.city]
        .filter(Boolean)
        .join(', ');
      if (parts) lines.push(`LOCATION:${this.escapeIcs(parts)}`);
    }

    // AUDIT FIX (F-Bug 3): include meeting URL via the URL property
    // for ONLINE sessions, but ONLY when the caller is a confirmed
    // participant. The link as it is now wins, as on join-info: a changed
    // link must reach people already booked; the saved one is a fallback.
    if (instance.template.locationKind === 'ONLINE' && isConfirmed) {
      const url =
        instance.meetingUrlOverride ??
        instance.template.meetingUrl ??
        participant?.snapshotMeetingUrl;
      if (url) lines.push(`URL:${url}`);
    }

    // Organizer
    if (instance.instructor) {
      const name =
        `${instance.instructor.firstName ?? ''} ${instance.instructor.lastName ?? ''}`.trim();
      const email = instance.instructor.email;
      if (email) {
        lines.push(`ORGANIZER;CN=${this.escapeIcs(name)}:mailto:${email}`);
      }
    }

    lines.push('END:VEVENT', 'END:VCALENDAR');
    return lines.join('\r\n');
  }

  // ─── JOIN INFO (day-of polling) ───────────────────────────────────

  async joinInfo(callerId: string, instanceId: string): Promise<JoinInfo> {
    const participant = await this.participantModel.findOne({
      where: {
        instanceId,
        userId: callerId,
        status: SessionParticipantStatus.Confirmed,
      },
      attributes: ['id', 'snapshotMeetingUrl'],
    });
    if (!participant) {
      // Could be: not booked, not confirmed, wrong user. Always 403 so
      // we don't leak the difference (existence + confirmation state).
      throw new ForbiddenException(apiError('session.joinConfirmedOnly'));
    }

    // Running sessions too: the hourly job marks a session IN_PROGRESS at
    // its start, and the link must work until start + 15 minutes, as both
    // apps promise. The time window below decides when it closes.
    const instance = await this.instanceModel.findOne({
      where: {
        id: instanceId,
        status: {
          [Op.in]: [
            SessionInstanceStatus.Scheduled,
            SessionInstanceStatus.InProgress,
          ],
        },
      },
      include: [
        {
          model: SessionTemplate,
          attributes: ['meetingUrl', 'locationKind'],
          required: true,
        },
      ],
      attributes: ['id', 'startAt', 'meetingUrlOverride'],
    });
    if (!instance) {
      throw new NotFoundException(apiError('session.notFound'));
    }

    // The link as it is now: a coach who changes it (a broken room, a new
    // call) must reach everyone already booked. The one saved at booking
    // is only the fallback when the session has none any more.
    const meetingUrl =
      instance.meetingUrlOverride ??
      instance.template.meetingUrl ??
      participant.snapshotMeetingUrl ??
      null;

    if (!meetingUrl) {
      throw new NotFoundException(apiError('session.noMeetingLink'));
    }

    const start = instance.startAt.getTime();
    return {
      meetingUrl,
      joinActiveFrom: new Date(start - JOIN_BEFORE_START_MS),
      joinActiveUntil: new Date(start + JOIN_AFTER_START_MS),
      instructorJoined: false, // not modeled yet; future: ping from FE
    };
  }

  // ─── helpers ──────────────────────────────────────────────────────

  private buildTabWhere(
    userId: string,
    tab: 'upcoming' | 'pendingApproval' | 'waitlisted' | 'past' | 'cancelled',
  ): Record<string, unknown> {
    switch (tab) {
      case 'upcoming':
        return { userId, status: SessionParticipantStatus.Confirmed };
      case 'pendingApproval':
        return { userId, status: SessionParticipantStatus.PendingApproval };
      case 'waitlisted':
        return { userId, status: SessionParticipantStatus.Waitlisted };
      case 'past':
        return { userId, status: SessionParticipantStatus.Confirmed };
      case 'cancelled':
        return {
          userId,
          status: {
            [Op.in]: [
              SessionParticipantStatus.Cancelled,
              SessionParticipantStatus.Declined,
            ],
          },
        };
    }
  }

  private buildInstanceFilterForTab(
    tab: 'upcoming' | 'pendingApproval' | 'waitlisted' | 'past' | 'cancelled',
  ): Record<string, unknown> {
    const now = new Date();
    switch (tab) {
      case 'upcoming':
      case 'pendingApproval':
      case 'waitlisted':
        return { startAt: { [Op.gte]: now } };
      case 'past':
        return { startAt: { [Op.lt]: now } };
      case 'cancelled':
        // No time filter — cancellations can be past or future.
        return {};
    }
  }

  private orderForTab(
    tab: 'upcoming' | 'pendingApproval' | 'waitlisted' | 'past' | 'cancelled',
  ): 'ASC' | 'DESC' {
    return tab === 'past' || tab === 'cancelled' ? 'DESC' : 'ASC';
  }

  /**
   * Escape characters that are special in iCalendar text values per
   * RFC 5545: backslash, semicolon, comma, newline. Newlines become `\n`.
   */
  private escapeIcs(value: string): string {
    return value
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }
}
