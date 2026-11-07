import {
  BadRequestException,
  forwardRef,
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
import { foldedContains } from '../../../common/utils/search.utils';
import { detectMeetingProvider } from '../../../common/utils/meeting-provider.util';
import { stripHtml } from '../../../common/utils/text.utils';
import { apiError } from '../../../common/i18n';
import { SearchIndexService } from '../../search/search-index.service';
import { VenueService } from '../../venue/venue.service';
import { Venue } from '../../venue/entities/venue.entity';
import { GroupService } from '../../group/group.service';
import { SessionTemplate } from '../entities/session-template.entity';
import { SessionInstance } from '../entities/session-instance.entity';
import {
  SessionInstanceStatus,
  SessionTemplateStatus,
} from '../entities/session.enums';
import { RecurrenceService } from './recurrence.service';
import { CreateTemplateDto } from '../dto/create-template.dto';
import { UpdateTemplateDto } from '../dto/update-template.dto';
import { ListTemplatesQueryDto } from '../dto/list-templates-query.dto';
import { PreviewRecurrenceDto } from '../dto/preview-recurrence.dto';
import { RegenerateInstancesDto } from '../dto/regenerate-instances.dto';

export interface ConflictWarning {
  code: 'CONFLICT';
  instanceIds: string[];
}

export interface CreateTemplateResult {
  template: SessionTemplate;
  generatedInstances: SessionInstance[];
  warnings: ConflictWarning[];
}

export interface RegenerateResult {
  generatedInstances: SessionInstance[];
  warnings: ConflictWarning[];
}

const TIMEZONE_VALUES = new Set(Intl.supportedValuesOf('timeZone'));

// Server-side past-date guard. Matches the @IsFutureOrCloseToNow DTO
// decorator but enforced defense-in-depth in case a future caller
// bypasses the DTO (e.g. service-to-service).
const SKEW_TOLERANCE_MS = 5 * 60_000;

function validateTimezone(tz: string): void {
  if (!TIMEZONE_VALUES.has(tz)) {
    throw new BadRequestException(apiError('session.invalidTimezone'));
  }
}

function assertNotPast(value: Date): void {
  if (value.getTime() < Date.now() - SKEW_TOLERANCE_MS) {
    throw new BadRequestException(apiError('session.startInPast'));
  }
}

// Strip HTML on every text field the user controls and clamp length.
// title is short; description is long but capped at 4000 by the DTO.
const TITLE_MAX = 255;
const DESCRIPTION_MAX = 4000;

/**
 * Rolling horizon: how many future occurrences the recurring-generation
 * sweep keeps materialised per active template.
 */
const RECURRING_MIN_FUTURE = 8;

function slugifyBase(title: string): string {
  const normalized = title.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return slug || 'session';
}

@Injectable()
export class SessionTemplateService {
  constructor(
    @InjectModel(SessionTemplate)
    private readonly templateModel: typeof SessionTemplate,
    @InjectModel(SessionInstance)
    private readonly instanceModel: typeof SessionInstance,
    private readonly recurrenceService: RecurrenceService,
    private readonly venueService: VenueService,
    @Inject(forwardRef(() => GroupService))
    private readonly groupService: GroupService,
    private readonly searchIndexService: SearchIndexService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async create(
    instructorId: string,
    dto: CreateTemplateDto,
  ): Promise<CreateTemplateResult> {
    validateTimezone(dto.timezone);

    const firstStart = new Date(dto.firstStartAt);
    assertNotPast(firstStart);

    // Sanitize free-text fields before persisting. Strip HTML/script,
    // clamp lengths. The DTO already enforces TITLE_MAX/DESCRIPTION_MAX
    // but sanitization can change byte length, so re-clamp here.
    const safeTitle = stripHtml(dto.title, TITLE_MAX);
    if (!safeTitle) {
      throw new BadRequestException(apiError('session.titleRequired'));
    }
    const safeDescription = dto.description
      ? stripHtml(dto.description, DESCRIPTION_MAX) || null
      : null;

    // Validate cross-resource ownership BEFORE inserting. Without this,
    // an instructor can attach their session to a venue/group owned by
    // another instructor — IDOR. assertOwned (used inside VenueService/
    // GroupService) returns 404 on mismatch so we don't leak existence.
    if (dto.venueId) {
      await this.venueService.get(instructorId, dto.venueId);
    }
    if (dto.groupId) {
      await this.groupService.getById(dto.groupId, instructorId);
    }

    const sequelize = this.templateModel.sequelize!;
    const tx = await sequelize.transaction();

    try {
      const slug = await this.generateUniqueSlug(instructorId, safeTitle, tx);

      const meetingProvider = dto.meetingUrl
        ? (detectMeetingProvider(dto.meetingUrl) ?? null)
        : null;

      const template = await this.templateModel.create(
        {
          instructorId,
          groupId: dto.groupId ?? null,
          venueId: dto.venueId ?? null,
          slug,
          title: safeTitle,
          description: safeDescription,
          type: dto.type,
          access: dto.access,
          approvalRequired: dto.approvalRequired ?? false,
          locationKind: dto.locationKind,
          meetingUrl: dto.meetingUrl ?? null,
          meetingProvider,
          durationMinutes: dto.durationMinutes,
          timezone: dto.timezone,
          capacity: dto.capacity ?? null,
          waitlistEnabled: dto.waitlistEnabled ?? true,
          cancellationCutoffHours: dto.cancellationCutoffHours ?? 24,
          priceAmountCents: dto.priceAmountCents ?? 0,
          priceCurrency: dto.priceCurrency ?? 'RON',
          isRecurring: dto.isRecurring,
          recurrenceRule: dto.recurrenceRule ?? null,
          firstStartAt: new Date(dto.firstStartAt),
          status: SessionTemplateStatus.Active,
        },
        { transaction: tx },
      );

      const generatedInstances: SessionInstance[] = [];

      const shouldGenerate = dto.isRecurring
        ? dto.generateInitialInstances === true ||
          (dto.initialInstancesCount != null && dto.initialInstancesCount > 0)
        : dto.generateInitialInstances !== false;

      if (shouldGenerate) {
        if (!dto.isRecurring) {
          const instance = await this.createInstance(
            template,
            0,
            new Date(dto.firstStartAt),
            tx,
          );
          generatedInstances.push(instance);
        } else if (dto.recurrenceRule) {
          const count = dto.initialInstancesCount ?? 12;
          const { dates } = this.recurrenceService.computeOccurrences(
            new Date(dto.firstStartAt),
            dto.recurrenceRule,
            dto.timezone,
            count,
          );
          for (let i = 0; i < dates.length; i++) {
            const instance = await this.createInstance(
              template,
              i,
              dates[i],
              tx,
            );
            generatedInstances.push(instance);
          }
        }
      }

      await tx.commit();
      this.logger.log?.(
        `Template created: ${template.id} by instructor ${instructorId}`,
      );
      // Index after commit so a search-index write failure can't
      // roll back the user-visible create. Mirrors GroupService.
      try {
        await this.searchIndexService.upsertSession(template.id);
      } catch (e) {
        this.logger.error?.(
          `Search-index upsert failed for template ${template.id}: ${String(e)}`,
        );
      }
      return { template, generatedInstances, warnings: [] };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  }

  async list(
    instructorId: string,
    query: ListTemplatesQueryDto,
  ): Promise<PaginatedResponse<SessionTemplate>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const where: Record<string, unknown> = { instructorId };

    if (query.tab) {
      switch (query.tab) {
        case 'active':
          where['status'] = SessionTemplateStatus.Active;
          break;
        case 'recurring':
          where['status'] = SessionTemplateStatus.Active;
          where['isRecurring'] = true;
          break;
        case 'ended':
          where['status'] = SessionTemplateStatus.Ended;
          break;
        case 'cancelled':
          where['status'] = SessionTemplateStatus.Cancelled;
          break;
      }
    }

    if (query.type) where['type'] = query.type;
    if (query.access) where['access'] = query.access;
    if (query.locationKind) where['locationKind'] = query.locationKind;
    if (query.groupId) where['groupId'] = query.groupId;

    if (query.q) {
      // Blind to accents and case, wildcards escaped (`foldedContains`).
      const esc = (value: string) =>
        this.templateModel.sequelize!.escape(value);
      where[Op.or as unknown as string] = [
        foldedContains('"SessionTemplate"."title"', query.q, esc),
        foldedContains('"SessionTemplate"."description"', query.q, esc),
      ];
    }

    const sortBy = query.sortBy ?? 'firstStartAt';
    const sortDir = query.sortDir ?? 'DESC';

    const { rows, count } = await this.templateModel.findAndCountAll({
      where,
      order: [[sortBy, sortDir]],
      limit,
      offset: getOffset(page, limit),
    });

    return buildPaginatedResponse(rows, count, page, limit);
  }

  async getById(
    instructorId: string,
    templateId: string,
  ): Promise<SessionTemplate> {
    const template = await this.templateModel.findOne({
      where: { id: templateId, instructorId },
      include: [
        {
          model: Venue,
          as: 'venue',
          attributes: ['id', 'name', 'city', 'kind'],
          required: false,
        },
      ],
    });
    if (!template) throw new NotFoundException(apiError('session.notFound'));
    return template;
  }

  async update(
    instructorId: string,
    templateId: string,
    dto: UpdateTemplateDto,
  ): Promise<SessionTemplate> {
    const template = await this.getById(instructorId, templateId);

    if (dto.timezone) validateTimezone(dto.timezone);

    // Re-validate cross-resource ownership when these fields change.
    // (Same IDOR vector as create.)
    if (dto.venueId) {
      await this.venueService.get(instructorId, dto.venueId);
    }
    if (dto.groupId) {
      await this.groupService.getById(dto.groupId, instructorId);
    }

    const updates: Partial<SessionTemplate> = {};

    if (dto.title !== undefined) {
      const safe = stripHtml(dto.title, TITLE_MAX);
      if (!safe) {
        throw new BadRequestException(apiError('session.titleRequired'));
      }
      updates.title = safe;
    }
    if (dto.description !== undefined) {
      updates.description = dto.description
        ? stripHtml(dto.description, DESCRIPTION_MAX) || null
        : null;
    }
    if (dto.type !== undefined) updates.type = dto.type;
    if (dto.access !== undefined) updates.access = dto.access;
    if (dto.approvalRequired !== undefined)
      updates.approvalRequired = dto.approvalRequired;
    if (dto.groupId !== undefined) updates.groupId = dto.groupId;
    if (dto.locationKind !== undefined) updates.locationKind = dto.locationKind;
    if (dto.venueId !== undefined) updates.venueId = dto.venueId;
    if (dto.durationMinutes !== undefined)
      updates.durationMinutes = dto.durationMinutes;
    if (dto.timezone !== undefined) updates.timezone = dto.timezone;
    if (dto.capacity !== undefined) updates.capacity = dto.capacity;
    if (dto.waitlistEnabled !== undefined)
      updates.waitlistEnabled = dto.waitlistEnabled;
    if (dto.cancellationCutoffHours !== undefined)
      updates.cancellationCutoffHours = dto.cancellationCutoffHours;
    if (dto.priceAmountCents !== undefined)
      updates.priceAmountCents = dto.priceAmountCents;
    if (dto.priceCurrency !== undefined)
      updates.priceCurrency = dto.priceCurrency;
    if (dto.recurrenceRule !== undefined)
      updates.recurrenceRule = dto.recurrenceRule;

    if (dto.meetingUrl !== undefined) {
      updates.meetingUrl = dto.meetingUrl;
      updates.meetingProvider = dto.meetingUrl
        ? (detectMeetingProvider(dto.meetingUrl) ?? null)
        : null;
    }

    await template.update(updates);
    // Search index follows the source of truth — a title or location
    // edit needs to surface in the next search.
    try {
      await this.searchIndexService.upsertSession(template.id);
    } catch (e) {
      this.logger.error?.(
        `Search-index upsert failed for template ${template.id}: ${String(e)}`,
      );
    }
    return template;
  }

  async delete(instructorId: string, templateId: string): Promise<void> {
    const template = await this.getById(instructorId, templateId);
    const sequelize = this.templateModel.sequelize!;
    const tx = await sequelize.transaction();

    try {
      await this.instanceModel.update(
        { status: SessionInstanceStatus.Cancelled, cancelledAt: new Date() },
        {
          where: {
            templateId,
            status: SessionInstanceStatus.Scheduled,
            startAt: { [Op.gt]: new Date() },
          },
          transaction: tx,
        },
      );

      await template.update(
        { status: SessionTemplateStatus.Ended, endedAt: new Date() },
        { transaction: tx },
      );
      await template.destroy({ transaction: tx });

      await tx.commit();

      // Drop from the search index after commit. upsertSession sees
      // status != ACTIVE and removes the row.
      try {
        await this.searchIndexService.upsertSession(templateId);
      } catch (e) {
        this.logger.error?.(
          `Search-index remove failed for template ${templateId}: ${String(e)}`,
        );
      }
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  }

  previewRecurrence(dto: PreviewRecurrenceDto): {
    occurrences: string[];
    truncated: boolean;
  } {
    validateTimezone(dto.timezone);

    const weeksHorizon = dto.weeksHorizon ?? 12;
    const cap = weeksHorizon * 7; // generous upper bound; recurrence will be ≤ this

    const { dates, truncated } = this.recurrenceService.computeOccurrences(
      new Date(dto.firstStartAt),
      dto.rule,
      dto.timezone,
      cap,
    );

    return {
      occurrences: dates.map((d) => d.toISOString()),
      truncated,
    };
  }

  async regenerate(
    instructorId: string,
    templateId: string,
    dto: RegenerateInstancesDto,
  ): Promise<RegenerateResult> {
    const template = await this.getById(instructorId, templateId);

    if (!template.isRecurring || !template.recurrenceRule) {
      throw new BadRequestException(apiError('session.notRecurring'));
    }

    const sequelize = this.templateModel.sequelize!;
    const tx = await sequelize.transaction();

    try {
      const generatedInstances = await this._generateNext(
        template,
        dto.count,
        tx,
      );
      await tx.commit();
      return { generatedInstances, warnings: [] };
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  }

  /**
   * System sweep (jobs module, `sessions.generate_recurring`): keep
   * every active recurring template topped up to a rolling horizon of
   * future occurrences. Without this, recurring sessions stop being
   * bookable once their initially-materialised batch is exhausted.
   *
   * Idempotent: `_generateNext` resumes from the latest existing
   * `occurrenceIndex`, so a re-run never duplicates. Finite recurrences
   * (endDate / endAfterOccurrences) naturally stop producing dates.
   * Per-template tx; one bad template is logged and skipped, never
   * aborting the whole sweep.
   */
  async generateDueRecurringForAll(now: Date): Promise<{
    templatesScanned: number;
    templatesToppedUp: number;
    created: number;
  }> {
    const templates = await this.templateModel.findAll({
      where: {
        isRecurring: true,
        status: SessionTemplateStatus.Active,
      },
    });

    let created = 0;
    let toppedUp = 0;

    for (const template of templates) {
      if (!template.recurrenceRule) continue;

      const futureCount = await this.instanceModel.count({
        where: {
          templateId: template.id,
          startAt: { [Op.gt]: now },
          status: { [Op.ne]: SessionInstanceStatus.Cancelled },
        },
      });
      if (futureCount >= RECURRING_MIN_FUTURE) continue;

      const need = RECURRING_MIN_FUTURE - futureCount;
      const tx = await this.templateModel.sequelize!.transaction();
      try {
        const newInstances = await this._generateNext(template, need, tx);
        await tx.commit();
        if (newInstances.length > 0) {
          created += newInstances.length;
          toppedUp += 1;
        }
      } catch (err) {
        await tx.rollback();
        this.logger.error?.(
          `Recurring top-up failed for template ${template.id}: ${String(err)}`,
          undefined,
          'SessionTemplateService',
        );
      }
    }

    return {
      templatesScanned: templates.length,
      templatesToppedUp: toppedUp,
      created,
    };
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async generateUniqueSlug(
    instructorId: string,
    title: string,
    tx?: import('sequelize').Transaction,
  ): Promise<string> {
    const base = slugifyBase(title);

    for (let n = 0; n < 99; n++) {
      const candidate = n === 0 ? base : `${base}-${n + 1}`;
      const existing = await this.templateModel.findOne({
        where: { instructorId, slug: candidate },
        paranoid: false,
        transaction: tx,
      });
      if (!existing) return candidate;
    }

    // Fallback: random 6-char suffix
    return `${base}-${Math.random().toString(36).slice(2, 8)}`;
  }

  /**
   * Generate up to `count` occurrences *after* the latest existing one
   * for a recurring template, inside the caller's transaction. Shared
   * by `regenerate` (instructor-triggered) and `generateDueRecurringForAll`
   * (system sweep). Resumes from the latest `occurrenceIndex` so it's
   * idempotent — re-running never duplicates. Caller must have verified
   * `template.recurrenceRule` is present.
   */
  private async _generateNext(
    template: SessionTemplate,
    count: number,
    tx: import('sequelize').Transaction,
  ): Promise<SessionInstance[]> {
    if (count <= 0 || !template.recurrenceRule) return [];

    const latest = await this.instanceModel.findOne({
      where: { templateId: template.id },
      order: [['occurrenceIndex', 'DESC']],
      paranoid: false,
      transaction: tx,
    });

    const nextIndex = latest ? latest.occurrenceIndex + 1 : 0;
    const afterDate = latest ? latest.startAt : template.firstStartAt;

    const { dates } = this.recurrenceService.computeOccurrences(
      template.firstStartAt,
      template.recurrenceRule,
      template.timezone,
      nextIndex + count,
    );

    const newDates = dates.slice(nextIndex, nextIndex + count);

    const generated: SessionInstance[] = [];
    for (let i = 0; i < newDates.length; i++) {
      const d = newDates[i];
      if (latest && d <= afterDate) continue; // skip any overlap
      generated.push(await this.createInstance(template, nextIndex + i, d, tx));
    }
    return generated;
  }

  private async createInstance(
    template: SessionTemplate,
    occurrenceIndex: number,
    startAt: Date,
    tx: import('sequelize').Transaction,
  ): Promise<SessionInstance> {
    const endAt = new Date(
      startAt.getTime() + template.durationMinutes * 60_000,
    );

    return this.instanceModel.create(
      {
        templateId: template.id,
        instructorId: template.instructorId,
        occurrenceIndex,
        startAt,
        endAt,
        status: SessionInstanceStatus.Scheduled,
        isOverride: false,
        confirmedCount: 0,
        pendingApprovalCount: 0,
        waitlistedCount: 0,
      },
      { transaction: tx },
    );
  }
}
