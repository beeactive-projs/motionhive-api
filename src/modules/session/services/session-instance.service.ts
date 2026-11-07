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
import { apiError } from '../../../common/i18n';
import { User } from '../../user/entities/user.entity';
import { Venue } from '../../venue/entities/venue.entity';
import { SessionInstance } from '../entities/session-instance.entity';
import { SessionTemplate } from '../entities/session-template.entity';
import { SessionParticipant } from '../entities/session-participant.entity';
import { SessionParticipantStatus } from '../entities/session.enums';
import { ListInstancesQueryDto } from '../dto/list-instances-query.dto';
import { ListParticipantsQueryDto } from '../dto/list-participants-query.dto';
import { SessionAccessService } from './session-access.service';

const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 180;

// Field allowlists drive eager-load `attributes:` to prevent N+1
// AND to prevent leaking unrelated fields (e.g. user.passwordHash).
const INSTRUCTOR_FIELDS = [
  'id',
  'firstName',
  'lastName',
  'avatarUrl',
  'handle',
] as const;

const VENUE_FIELDS = ['id', 'name', 'city', 'kind'] as const;

const TEMPLATE_FIELDS = [
  'id',
  'slug',
  'title',
  'description',
  'type',
  'access',
  'approvalRequired',
  'locationKind',
  'meetingUrl',
  'meetingProvider',
  'durationMinutes',
  'timezone',
  'capacity',
  'waitlistEnabled',
  'cancellationCutoffHours',
  'priceAmountCents',
  'priceCurrency',
  'instructorId',
  'groupId',
  'venueId',
] as const;

/**
 * Read surface for session instances.
 *
 * Visibility rule:
 *   - When the caller filters by `instructorId === self`, returns the
 *     instructor's own calendar (any status, any participants).
 *   - When `instructorId` is another user, returns only instances the
 *     caller is actively participating in (NOT CANCELLED / DECLINED).
 *   - When `instructorId` is omitted, defaults to the caller's own.
 *
 * N+1 prevention:
 *   - Every list query uses a single `findAndCountAll` with `include:`
 *     (template, instructor, venueOverride). Participant counts are
 *     already denormalised on the instance row.
 *   - Detail returns the first 10 participants only; the dedicated
 *     `/participants` endpoint paginates the rest. Eager-loading
 *     hundreds of participants on every detail request is a footgun.
 */
@Injectable()
export class SessionInstanceService {
  constructor(
    @InjectModel(SessionInstance)
    private readonly instanceModel: typeof SessionInstance,
    @InjectModel(SessionParticipant)
    private readonly participantModel: typeof SessionParticipant,
    private readonly accessService: SessionAccessService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async list(
    callerId: string,
    query: ListInstancesQueryDto,
  ): Promise<PaginatedResponse<SessionInstance>> {
    const { dateFrom, dateTo } = this.resolveDateWindow(
      query.dateFrom,
      query.dateTo,
    );

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const targetInstructorId = query.instructorId ?? callerId;
    const callerIsTarget = targetInstructorId === callerId;

    const where: Record<string, unknown> = {
      instructorId: targetInstructorId,
      startAt: { [Op.gte]: dateFrom, [Op.lt]: dateTo },
    };
    if (query.status) where['status'] = query.status;
    if (query.templateId) where['templateId'] = query.templateId;

    // Cross-instructor view: scope to "instances the caller is booked into".
    // Single JOIN (Sequelize `include` with `required: true`) — no N+1.
    const include: IncludeOptions[] = [
      {
        model: SessionTemplate,
        attributes: [...TEMPLATE_FIELDS],
        required: true,
        include: [
          {
            model: Venue,
            as: 'venue',
            attributes: [...VENUE_FIELDS],
            required: false,
          },
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
    ];

    if (!callerIsTarget) {
      include.push({
        model: SessionParticipant,
        as: 'participants',
        attributes: ['id', 'status', 'userId'],
        required: true,
        where: {
          userId: callerId,
          status: {
            [Op.notIn]: [
              SessionParticipantStatus.Cancelled,
              SessionParticipantStatus.Declined,
            ],
          },
        },
      });
    } else if (query.clientId) {
      // Own calendar, narrowed to one person's bookings — what the
      // client profile's Sessions tab asks for. Same join shape as the
      // cross-instructor case; a filter over rows the caller already
      // owns, so it widens nothing. Cancelled/declined stay out so the
      // tab reads as "their sessions", not "every booking attempt".
      include.push({
        model: SessionParticipant,
        as: 'participants',
        attributes: ['id', 'status', 'userId'],
        required: true,
        where: {
          userId: query.clientId,
          status: {
            [Op.notIn]: [
              SessionParticipantStatus.Cancelled,
              SessionParticipantStatus.Declined,
            ],
          },
        },
      });
    }

    const { rows, count } = await this.instanceModel.findAndCountAll({
      where,
      include,
      order: [['startAt', query.order === 'desc' ? 'DESC' : 'ASC']],
      limit,
      offset: getOffset(page, limit),
      // distinct keeps the count correct when JOIN duplicates rows
      distinct: true,
    });

    return buildPaginatedResponse(rows, count, page, limit);
  }

  /**
   * Fetch a single instance. Visibility gated by `SessionAccessService`.
   * Owner sees the full payload including the first 10 participants.
   * Eligible non-owner sees the same minus participants.
   * Blocked caller → 404 (no existence leak; matches the venue convention).
   */
  async getById(
    callerId: string,
    instanceId: string,
  ): Promise<SessionInstance> {
    const instance = await this.instanceModel.findOne({
      where: { id: instanceId },
      include: [
        {
          model: SessionTemplate,
          attributes: [...TEMPLATE_FIELDS],
          required: true,
          // Eager-load the template's base venue so the FE can show
          // "Where & how" even when there's no per-instance override.
          include: [
            {
              model: Venue,
              as: 'venue',
              attributes: [...VENUE_FIELDS],
              required: false,
            },
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
    });
    if (!instance) {
      throw new NotFoundException(apiError('session.notFound'));
    }

    const access = await this.accessService.evaluate(
      instance,
      instance.template,
      callerId,
    );
    if (!access.canView) {
      throw new NotFoundException(apiError('session.notFound'));
    }

    if (access.isOwner) {
      // Lazy-load first 10 participants ONLY for the owner. Keeps the
      // non-owner path one query lighter.
      const participants = await this.participantModel.findAll({
        where: { instanceId },
        attributes: [
          'id',
          'userId',
          'status',
          'attended',
          'bookedAt',
          'bookingNote',
          // privateNote intentionally included — owner-only path
          'privateNote',
          'waitlistPosition',
        ],
        include: [
          {
            model: User,
            attributes: [...INSTRUCTOR_FIELDS],
            required: false,
          },
        ],
        order: [['bookedAt', 'ASC']],
        limit: 10,
      });
      // Attach via Sequelize's setter so it serialises into JSON output.
      instance.setDataValue('participants', participants);
    }

    return instance;
  }

  async listParticipants(
    instructorId: string,
    instanceId: string,
    query: ListParticipantsQueryDto,
  ): Promise<PaginatedResponse<SessionParticipant>> {
    // Ownership check (cheap — pk lookup with instructorId scope).
    const instance = await this.instanceModel.findOne({
      where: { id: instanceId, instructorId },
      attributes: ['id'],
    });
    if (!instance) {
      throw new NotFoundException(apiError('session.notFound'));
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Record<string, unknown> = { instanceId };
    if (query.status) where['status'] = query.status;

    const { rows, count } = await this.participantModel.findAndCountAll({
      where,
      attributes: [
        'id',
        'userId',
        'status',
        'attended',
        'bookedAt',
        'bookingNote',
        'privateNote',
        'waitlistPosition',
        'snapshotPriceCents',
        'snapshotCurrency',
      ],
      include: [
        {
          model: User,
          attributes: [...INSTRUCTOR_FIELDS],
          required: false,
        },
      ],
      order: [['bookedAt', 'ASC']],
      limit,
      offset: getOffset(page, limit),
    });

    return buildPaginatedResponse(rows, count, page, limit);
  }

  // ─── helpers ────────────────────────────────────────────────────────

  private resolveDateWindow(
    fromIso: string | undefined,
    toIso: string | undefined,
  ): { dateFrom: Date; dateTo: Date } {
    const now = Date.now();
    const dateFrom = fromIso ? new Date(fromIso) : new Date(now);
    const dateTo = toIso
      ? new Date(toIso)
      : new Date(now + DEFAULT_WINDOW_DAYS * 86_400_000);

    if (Number.isNaN(dateFrom.getTime()) || Number.isNaN(dateTo.getTime())) {
      throw new BadRequestException(apiError('session.invalidDateRange'));
    }
    if (dateFrom >= dateTo) {
      throw new BadRequestException(apiError('session.dateRangeOrder'));
    }
    const spanDays = (dateTo.getTime() - dateFrom.getTime()) / 86_400_000;
    if (spanDays > MAX_WINDOW_DAYS) {
      throw new BadRequestException(
        apiError('session.dateRangeTooWide', { days: MAX_WINDOW_DAYS }),
      );
    }
    return { dateFrom, dateTo };
  }
}
