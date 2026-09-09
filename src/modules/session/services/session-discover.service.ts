import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op, type IncludeOptions } from 'sequelize';
import {
  buildPaginatedResponse,
  getOffset,
  PaginatedResponse,
} from '../../../common/dto/pagination.dto';
import { User } from '../../user/entities/user.entity';
import { Venue } from '../../venue/entities/venue.entity';
import {
  InstructorClient,
  InstructorClientStatus,
} from '../../client/entities/instructor-client.entity';
import { GroupMember } from '../../group/entities/group-member.entity';
import { SessionInstance } from '../entities/session-instance.entity';
import { SessionTemplate } from '../entities/session-template.entity';
import {
  SessionAccess,
  SessionInstanceStatus,
  SessionTemplateStatus,
} from '../entities/session.enums';
import { DiscoverSessionsQueryDto } from '../dto/discover-sessions.dto';
import { SessionAccessService } from './session-access.service';

/**
 * Public discover + redacted-public detail.
 *
 * Privacy invariants (audited via test):
 *   - `meetingUrl` (and `meetingUrlOverride`) NEVER appear in any public
 *     response. Public callers cannot join an online session via discover
 *     — they must book first, then hit /join-info (Phase F) when confirmed.
 *   - `participants`, `privateNote`, `bookingNote` NEVER appear.
 *   - For GROUP_ONLY sessions a non-member sees a **redacted "blocked"
 *     shape** containing only the title, instructor, type, access, and
 *     start time. No description, no venue, no capacity. This matches
 *     the `c-detail-blocked` design artboard.
 *
 * Eligibility:
 *   - unauthenticated → OPEN/FREE only
 *   - authenticated → also CLIENTS_ONLY (active relationship) and
 *     GROUP_ONLY (current member). Two cheap indexed subqueries
 *     materialize the eligibility set.
 *
 * Caching:
 *   - Discover and slug routes are HTTP-cacheable for short windows
 *     (60s discover, 120s slug). Headers set in the controller.
 */

// Hard cap to keep index scans tight and discourage scrapers.
const MAX_WINDOW_DAYS = 90;
const DEFAULT_WINDOW_DAYS = 30;

const PUBLIC_INSTRUCTOR_FIELDS = [
  'id',
  'firstName',
  'lastName',
  'avatarUrl',
  'handle',
] as const;
const PUBLIC_VENUE_FIELDS = ['id', 'name', 'city', 'kind'] as const;

// Fields shown for fully-visible (OPEN/FREE or eligible) public listings.
// Crucially: NO meetingUrl, NO meetingUrlOverride. Public callers don't
// get the join link — they must book first.
const PUBLIC_TEMPLATE_FIELDS = [
  'id',
  'slug',
  'title',
  'description',
  'type',
  'access',
  'approvalRequired',
  'locationKind',
  'meetingProvider', // safe (label only, no URL)
  'durationMinutes',
  'timezone',
  'capacity',
  'waitlistEnabled',
  'cancellationCutoffHours',
  'priceAmountCents',
  'priceCurrency',
  'instructorId',
  'groupId',
] as const;

// Fields shown when the session is blocked (GROUP_ONLY non-member).
// Bare minimum needed to render a "join the group to see this" CTA.
const BLOCKED_TEMPLATE_FIELDS = [
  'id',
  'slug',
  'title',
  'type',
  'access',
  'durationMinutes',
  'instructorId',
  'groupId',
] as const;

/**
 * The shape returned to a GROUP_ONLY non-member. Plain object — NOT a
 * Sequelize model — to guarantee zero risk of toJSON() leaking redacted
 * fields. Listed fields are the only ones the FE needs to render the
 * "join the group" CTA (`c-detail-blocked` artboard).
 */
export interface BlockedInstanceShape {
  id: string;
  templateId: string;
  instructorId: string;
  startAt: Date;
  endAt: Date;
  status: string;
  template: {
    id: string;
    slug: string;
    title: string;
    type: string;
    access: string;
    durationMinutes: number;
    instructorId: string;
    groupId: string | null;
  };
  instructor: {
    id: string;
    firstName: string;
    lastName: string;
    avatarUrl: string | null;
    handle: string | null;
  } | null;
  isBlocked: true;
}

@Injectable()
export class SessionDiscoverService {
  constructor(
    @InjectModel(SessionInstance)
    private readonly instanceModel: typeof SessionInstance,
    @InjectModel(SessionTemplate)
    private readonly templateModel: typeof SessionTemplate,
    @InjectModel(InstructorClient)
    private readonly clientModel: typeof InstructorClient,
    @InjectModel(GroupMember)
    private readonly groupMemberModel: typeof GroupMember,
    private readonly accessService: SessionAccessService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async discover(
    callerId: string | null,
    query: DiscoverSessionsQueryDto,
  ): Promise<PaginatedResponse<SessionInstance>> {
    const { dateFrom, dateTo } = this.resolveWindow(
      query.dateFrom,
      query.dateTo,
    );

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    // Build the access predicate: OPEN/FREE always; plus CLIENTS_ONLY and
    // GROUP_ONLY for authed callers who are eligible. Two precomputed
    // subqueries supply the eligible instructor + group id sets.
    const eligibleInstructorIds = callerId
      ? await this.fetchEligibleInstructorIds(callerId)
      : [];
    const eligibleGroupIds = callerId
      ? await this.fetchEligibleGroupIds(callerId)
      : [];

    const accessClauses: Record<string, unknown>[] = [
      { access: { [Op.in]: [SessionAccess.Open, SessionAccess.Free] } },
    ];
    if (eligibleInstructorIds.length > 0) {
      accessClauses.push({
        access: SessionAccess.ClientsOnly,
        instructorId: { [Op.in]: eligibleInstructorIds },
      });
    }
    if (eligibleGroupIds.length > 0) {
      accessClauses.push({
        access: SessionAccess.GroupOnly,
        groupId: { [Op.in]: eligibleGroupIds },
      });
    }

    // AUDIT FIX (E-Bug 4): the access OR clauses and the text-search
    // OR clauses must be ANDed together, not assigned to the same
    // `[Op.or]` key (which would silently overwrite). Use `[Op.and]`
    // with an array of OR groups.
    const andClauses: Record<string | symbol, unknown>[] = [
      { [Op.or]: accessClauses },
    ];
    if (query.q) {
      const term = `%${query.q.trim()}%`;
      andClauses.push({
        [Op.or]: [
          { title: { [Op.iLike]: term } },
          { description: { [Op.iLike]: term } },
        ],
      });
    }

    const templateInclude: IncludeOptions = {
      model: SessionTemplate,
      attributes: [...PUBLIC_TEMPLATE_FIELDS],
      required: true,
      // The venue the class normally runs at. `venueOverride` below only
      // carries a per-occurrence change, so without this an ordinary session
      // came back with no location at all — and where a session is is half of
      // whether someone can go to it.
      include: [
        {
          model: Venue,
          as: 'venue',
          attributes: [...PUBLIC_VENUE_FIELDS],
          required: false,
        },
      ],
      where: {
        status: SessionTemplateStatus.Active,
        [Op.and]: andClauses,
        ...(query.type ? { type: query.type } : {}),
        ...(query.locationKind ? { locationKind: query.locationKind } : {}),
        ...(query.instructorId ? { instructorId: query.instructorId } : {}),
        ...(query.groupId ? { groupId: query.groupId } : {}),
      },
    };

    const include: IncludeOptions[] = [
      templateInclude,
      {
        model: User,
        as: 'instructor',
        attributes: [...PUBLIC_INSTRUCTOR_FIELDS],
        required: false,
      },
      {
        model: Venue,
        as: 'venueOverride',
        attributes: [...PUBLIC_VENUE_FIELDS],
        required: false,
      },
    ];

    const { rows, count } = await this.instanceModel.findAndCountAll({
      where: {
        status: SessionInstanceStatus.Scheduled,
        startAt: { [Op.gte]: dateFrom, [Op.lt]: dateTo },
      },
      include,
      order: [['startAt', 'ASC']],
      limit,
      offset: getOffset(page, limit),
      distinct: true,
      attributes: this.publicInstanceAttributes(),
    });

    return buildPaginatedResponse(rows, count, page, limit);
  }

  /**
   * Resolve a slug-addressed instance: returns the NEXT upcoming
   * SCHEDULED instance of the template matching `instructorHandle` +
   * `templateSlug`. 404 if not OPEN/FREE.
   */
  async getBySlug(
    instructorHandle: string,
    templateSlug: string,
    callerId: string | null,
  ): Promise<SessionInstance | BlockedInstanceShape> {
    const instructor = await User.findOne({
      where: { handle: instructorHandle },
      attributes: ['id'],
    });
    if (!instructor) throw new NotFoundException('Session not found');

    const template = await this.templateModel.findOne({
      where: { instructorId: instructor.id, slug: templateSlug },
      attributes: [...PUBLIC_TEMPLATE_FIELDS, 'status'],
    });
    if (!template) throw new NotFoundException('Session not found');
    if (template.status !== SessionTemplateStatus.Active) {
      throw new NotFoundException('Session not found');
    }
    // Slug routes are anonymous-friendly only for OPEN/FREE; gated
    // sessions need the authed `/instances/:id/public` flow.
    if (
      template.access !== SessionAccess.Open &&
      template.access !== SessionAccess.Free
    ) {
      throw new NotFoundException('Session not found');
    }

    const instance = await this.findNextUpcoming(template.id);
    if (!instance) throw new NotFoundException('Session not found');

    return this.toPublicShape(instance, template, callerId);
  }

  /**
   * UUID-addressed public detail. Returns:
   *   - full PUBLIC shape if eligible (or OPEN/FREE) — Sequelize model
   *   - BLOCKED shape if GROUP_ONLY non-member — PLAIN object
   *   - 404 otherwise (CLIENTS_ONLY non-client)
   *
   * The return type widens to accommodate the plain-object blocked shape
   * because returning a partial Sequelize model risks toJSON() leaking
   * fields we redacted. The blocked shape is explicitly typed below.
   *
   * The scheduled-and-active filter is applied in `toPublicShape`, not here:
   * this endpoint is also where every session notification lands, and the
   * people who follow those links are the instructor and the people who
   * booked. Filtering in the query 404'd them the moment the session ended —
   * which made the post-session follow-up alert a link that could never work,
   * and turned every reminder into a dead link the day after. Strangers still
   * only see what is scheduled and live.
   */
  async getInstancePublic(
    instanceId: string,
    callerId: string | null,
  ): Promise<SessionInstance | BlockedInstanceShape> {
    const instance = await this.instanceModel.findOne({
      where: { id: instanceId },
      include: [
        {
          model: SessionTemplate,
          attributes: [...PUBLIC_TEMPLATE_FIELDS, 'status'],
          required: true,
        },
        {
          model: User,
          as: 'instructor',
          attributes: [...PUBLIC_INSTRUCTOR_FIELDS],
          required: false,
        },
        {
          model: Venue,
          as: 'venueOverride',
          attributes: [...PUBLIC_VENUE_FIELDS],
          required: false,
        },
      ],
      attributes: this.publicInstanceAttributes(),
    });
    if (!instance) throw new NotFoundException('Session not found');

    return this.toPublicShape(instance, instance.template, callerId);
  }

  // ─── helpers ──────────────────────────────────────────────────────

  private async toPublicShape(
    instance: SessionInstance,
    template: SessionTemplate,
    callerId: string | null,
  ): Promise<SessionInstance | BlockedInstanceShape> {
    const access = template.access;
    const isLive =
      instance.status === SessionInstanceStatus.Scheduled &&
      template.status === SessionTemplateStatus.Active;

    // A session that has finished, been cancelled, or whose template was
    // archived is no longer on offer — but the people it happened to still
    // need to reach it, because that is where their notifications point.
    if (!isLive) {
      if (!callerId) throw new NotFoundException('Session not found');
      const wasThere =
        callerId === instance.instructorId ||
        (await this.accessService.wasEverParticipant(instance.id, callerId));
      if (wasThere) return instance;
      throw new NotFoundException('Session not found');
    }

    if (access === SessionAccess.Open || access === SessionAccess.Free) {
      return instance;
    }
    // For non-OPEN, evaluate eligibility.
    const decision = await this.accessService.evaluate(
      instance,
      template,
      callerId,
    );
    if (decision.canView) {
      return instance;
    }
    // GROUP_ONLY non-member → return a redacted shape so the FE can
    // render the "join the group" CTA. For CLIENTS_ONLY non-client we
    // collapse to 404 (no obvious CTA, and we don't want to spray
    // existence info).
    if (access === SessionAccess.GroupOnly) {
      return this.toBlockedShape(instance, template);
    }
    throw new NotFoundException('Session not found');
  }

  /**
   * AUDIT FIX (E-Bug 2): construct a plain object. A partial
   * Sequelize model is dangerous — its toJSON() could surface
   * fields we explicitly redacted. A plain object can't leak.
   */
  private toBlockedShape(
    instance: SessionInstance,
    template: SessionTemplate,
  ): BlockedInstanceShape {
    return {
      id: instance.id,
      templateId: instance.templateId,
      instructorId: instance.instructorId,
      startAt: instance.startAt,
      endAt: instance.endAt,
      status: instance.status,
      template: {
        id: template.id,
        slug: template.slug,
        title: template.title,
        type: template.type,
        access: template.access,
        durationMinutes: template.durationMinutes,
        instructorId: template.instructorId,
        groupId: template.groupId,
      },
      instructor: instance.instructor
        ? {
            id: instance.instructor.id,
            firstName: instance.instructor.firstName,
            lastName: instance.instructor.lastName,
            avatarUrl: instance.instructor.avatarUrl,
            handle: instance.instructor.handle,
          }
        : null,
      isBlocked: true,
    };
  }

  private async findNextUpcoming(
    templateId: string,
  ): Promise<SessionInstance | null> {
    return this.instanceModel.findOne({
      where: {
        templateId,
        status: SessionInstanceStatus.Scheduled,
        startAt: { [Op.gte]: new Date() },
      },
      include: [
        {
          model: SessionTemplate,
          attributes: [...PUBLIC_TEMPLATE_FIELDS, 'status'],
          required: true,
        },
        {
          model: User,
          as: 'instructor',
          attributes: [...PUBLIC_INSTRUCTOR_FIELDS],
          required: false,
        },
        {
          model: Venue,
          as: 'venueOverride',
          attributes: [...PUBLIC_VENUE_FIELDS],
          required: false,
        },
      ],
      order: [['startAt', 'ASC']],
      attributes: this.publicInstanceAttributes(),
    });
  }

  private async fetchEligibleInstructorIds(userId: string): Promise<string[]> {
    // FIX (live): InstructorClient's "client" column is `client_id`,
    // not `user_id`. Use the entity attribute `clientId` here.
    const rows = await this.clientModel.findAll({
      where: { clientId: userId, status: InstructorClientStatus.ACTIVE },
      attributes: ['instructorId'],
    });
    return rows.map((r) => r.instructorId);
  }

  private async fetchEligibleGroupIds(userId: string): Promise<string[]> {
    const rows = await this.groupMemberModel.findAll({
      where: { userId, leftAt: null },
      attributes: ['groupId'],
    });
    return rows.map((r) => r.groupId);
  }

  /**
   * Allowlist of SessionInstance fields safe to return publicly.
   * Crucially excludes `meetingUrlOverride` (URL leak risk).
   */
  private publicInstanceAttributes(): string[] {
    return [
      'id',
      'templateId',
      'instructorId',
      'occurrenceIndex',
      'startAt',
      'endAt',
      'titleOverride',
      'descriptionOverride',
      'venueIdOverride',
      'capacityOverride',
      'isOverride',
      'status',
      'confirmedCount',
      'pendingApprovalCount',
      'waitlistedCount',
      // attended_count, cancel_reason, conflicting_instance_ids,
      // meetingUrlOverride: intentionally excluded.
    ];
  }

  private resolveWindow(
    fromIso: string | undefined,
    toIso: string | undefined,
  ): { dateFrom: Date; dateTo: Date } {
    const now = Date.now();
    const dateFrom = fromIso ? new Date(fromIso) : new Date(now);
    const dateTo = toIso
      ? new Date(toIso)
      : new Date(now + DEFAULT_WINDOW_DAYS * 86_400_000);
    if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime())) {
      throw new BadRequestException('Invalid date range');
    }
    if (dateFrom >= dateTo) {
      throw new BadRequestException('dateFrom must be before dateTo');
    }
    const spanDays = (dateTo.getTime() - dateFrom.getTime()) / 86_400_000;
    if (spanDays > MAX_WINDOW_DAYS) {
      throw new BadRequestException(
        `Date range too wide (max ${MAX_WINDOW_DAYS} days)`,
      );
    }
    return { dateFrom, dateTo };
  }
}
