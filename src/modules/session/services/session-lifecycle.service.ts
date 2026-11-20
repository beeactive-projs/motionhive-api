import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Sequelize } from 'sequelize-typescript';
import { Op, Transaction } from 'sequelize';
import { DateTime } from 'luxon';
import { stripHtml } from '../../../common/utils/text.utils';
import { apiError } from '../../../common/i18n';
import { VenueService } from '../../venue/venue.service';
import { NotificationService } from '../../notification/notification.service';
import { NotificationOutbox } from '../../notification/notification-outbox';
import { SessionInstance } from '../entities/session-instance.entity';
import { SessionParticipant } from '../entities/session-participant.entity';
import { SessionTemplate } from '../entities/session-template.entity';
import {
  SessionAccess,
  SessionInstanceStatus,
  SessionParticipantStatus,
  SessionTemplateStatus,
} from '../entities/session.enums';
import { SessionConflictService } from './session-conflict.service';
import { SessionWaitlistService } from './session-waitlist.service';
import { CancelInstanceDto } from '../dto/cancel-instance.dto';
import { RescheduleInstanceDto } from '../dto/reschedule-instance.dto';
import { PatchInstanceDto } from '../dto/patch-instance.dto';
import { FollowUpDto } from '../dto/follow-up.dto';
import {
  bookingPromotedForUser,
  groupDeletedBookingsEndedForUser,
  sessionCancelledForUser,
  sessionFollowUpForUser,
  sessionRescheduledForUser,
  type SessionRef,
} from '../notifications';

/**
 * Instance write surface: cancel (with scope), reschedule, override.
 *
 * Notification dedupe rule (the "send when good to send" part):
 *   - cancel scope=this   → 1 notification per affected participant
 *   - cancel scope=thisAndFuture / series → 1 notification per UNIQUE user
 *     across ALL affected instances. A user booked into 10 of the cancelled
 *     instances gets ONE message, not ten.
 *   - The notification ref points at the FIRST affected instance the user
 *     is in (chronologically) for series cancels.
 *
 * Conflict recompute fires inside the same tx so the warnings array
 * returned to the caller matches the persisted state.
 */
export interface CancelResult {
  scope: 'this' | 'thisAndFuture' | 'series';
  cancelledInstanceIds: string[];
  notifiedUserIds: string[];
}

export interface RescheduleResult {
  instanceId: string;
  oldStartAt: Date;
  newStartAt: Date;
  notifiedUserIds: string[];
  warnings: { code: 'CONFLICT'; instanceIds: string[] }[];
}

@Injectable()
export class SessionLifecycleService {
  constructor(
    @InjectModel(SessionInstance)
    private readonly instanceModel: typeof SessionInstance,
    @InjectModel(SessionParticipant)
    private readonly participantModel: typeof SessionParticipant,
    @InjectModel(SessionTemplate)
    private readonly templateModel: typeof SessionTemplate,
    private readonly conflictService: SessionConflictService,
    private readonly venueService: VenueService,
    private readonly waitlistService: SessionWaitlistService,
    private readonly notifications: NotificationService,
    private readonly sequelize: Sequelize,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // ─── SYSTEM SWEEP (jobs module) ──────────────────────────────────────

  /**
   * Advance instance lifecycle by the clock — driven by the
   * `sessions.status_transition` cron:
   *   SCHEDULED   → IN_PROGRESS  once `startAt` has passed
   *   IN_PROGRESS → COMPLETED    once `endAt` has passed
   *
   * Start-transition runs first so a long-overdue instance (e.g. the
   * cron was down for a while) lands on COMPLETED in a single run.
   * Idempotent via the WHERE guards; paranoid default scope excludes
   * soft-deleted rows. Silent — auto-transitions never notify
   * participants (locked decision). Cancelled instances are untouched.
   */
  async runStatusTransitions(
    now: Date,
  ): Promise<{ started: number; completed: number }> {
    return this.sequelize.transaction(async (tx) => {
      const [started] = await this.instanceModel.update(
        { status: SessionInstanceStatus.InProgress },
        {
          where: {
            status: SessionInstanceStatus.Scheduled,
            startAt: { [Op.lte]: now },
          },
          transaction: tx,
        },
      );

      const [completed] = await this.instanceModel.update(
        { status: SessionInstanceStatus.Completed },
        {
          where: {
            status: SessionInstanceStatus.InProgress,
            endAt: { [Op.lte]: now },
          },
          transaction: tx,
        },
      );

      return { started, completed };
    });
  }

  // ─── CANCEL (scope: this | thisAndFuture | series) ───────────────────

  async cancel(
    instructorId: string,
    instanceId: string,
    dto: CancelInstanceDto,
  ): Promise<CancelResult> {
    const outbox = new NotificationOutbox(this.notifications, this.logger);

    const result = await this.sequelize.transaction(async (tx) => {
      const root = await this.lockInstanceWithTemplate(instanceId, tx);
      this.assertOwner(root, instructorId);

      // AUDIT FIX (D-Bug 2): cannot "cancel" a session that already
      // completed or was cancelled. For scope=this we need root in
      // SCHEDULED. For scope=thisAndFuture/series we still need root
      // to be a meaningful anchor — accept SCHEDULED only.
      if (root.status !== SessionInstanceStatus.Scheduled) {
        throw new BadRequestException(apiError('session.cannotCancel'));
      }

      const safeReason = dto.reason ? stripHtml(dto.reason, 200) || null : null;
      const safeMessage = dto.message
        ? stripHtml(dto.message, 500) || null
        : null;

      // Build the set of affected instances per scope.
      let affected: SessionInstance[];
      switch (dto.scope) {
        case 'this':
          affected = [root];
          break;
        case 'thisAndFuture':
        case 'series': {
          // Future SCHEDULED siblings of the same template, plus root.
          // Past instances are preserved for history regardless of scope.
          const siblings = await this.instanceModel.findAll({
            where: {
              templateId: root.templateId,
              status: SessionInstanceStatus.Scheduled,
              startAt:
                dto.scope === 'series'
                  ? { [Op.gte]: new Date() }
                  : { [Op.gte]: root.startAt },
            },
            transaction: tx,
            lock: tx.LOCK.UPDATE,
          });
          // Ensure the root is included (it may be already, but be defensive)
          affected = siblings.some((s) => s.id === root.id)
            ? siblings
            : [...siblings, root];
          break;
        }
      }

      const now = new Date();
      const cancelledIds: string[] = [];

      // Bulk-cancel and zero the counters for each instance.
      for (const inst of affected) {
        if (inst.status !== SessionInstanceStatus.Scheduled) continue;
        await inst.update(
          {
            status: SessionInstanceStatus.Cancelled,
            cancelReason: safeReason,
            cancelledAt: now,
          },
          { transaction: tx },
        );
        cancelledIds.push(inst.id);
      }

      // "This and later": the series ends before this session, so the
      // nightly top-up generates nothing after it. It used to stay open,
      // and the cancelled sessions came back as new ones the next night.
      // Past sessions keep their history.
      if (dto.scope === 'thisAndFuture' && root.template.recurrenceRule) {
        const lastDay = DateTime.fromJSDate(root.startAt, { zone: 'utc' })
          .setZone(root.template.timezone)
          .minus({ days: 1 })
          .toISODate();
        const { endAfterOccurrences: _count, ...rule } =
          root.template.recurrenceRule;
        await root.template.update(
          { recurrenceRule: { ...rule, endDate: lastDay ?? undefined } },
          { transaction: tx },
        );
      }

      // Cancel the template too on scope=series.
      if (dto.scope === 'series') {
        await root.template.update(
          {
            status: SessionTemplateStatus.Cancelled,
            endedAt: now,
          },
          { transaction: tx },
        );
      }

      // ─── DISTINCT user fan-out ───────────────────────────────────────
      // Collect every non-terminal participant across affected instances,
      // then dedupe to userId. Pick the earliest instance per user for
      // the notification ref so it deep-links to a meaningful occurrence.
      const participants = await this.participantModel.findAll({
        where: {
          instanceId: { [Op.in]: cancelledIds },
          status: {
            [Op.notIn]: [
              SessionParticipantStatus.Cancelled,
              SessionParticipantStatus.Declined,
            ],
          },
        },
        attributes: ['id', 'userId', 'instanceId'],
        transaction: tx,
      });

      // Mark them all CANCELLED. Snapshot fields stay; that's the audit
      // trail of what they had booked. Filter by `instanceId IN (...)` —
      // the cancelledIds set is bounded by the affected-instances query,
      // which is itself bounded by the recurrence rule. Avoids passing a
      // potentially huge id-array through the IN clause.
      if (cancelledIds.length > 0) {
        await this.participantModel.update(
          { status: SessionParticipantStatus.Cancelled, cancelledAt: now },
          {
            where: {
              instanceId: { [Op.in]: cancelledIds },
              status: {
                [Op.notIn]: [
                  SessionParticipantStatus.Cancelled,
                  SessionParticipantStatus.Declined,
                ],
              },
            },
            transaction: tx,
          },
        );
      }

      // Build {userId → earliest affected instance} for the notification.
      const earliestPerUser = new Map<string, SessionInstance>();
      // Index affected by id for quick lookup.
      const instById = new Map(affected.map((i) => [i.id, i]));
      for (const p of participants) {
        const inst = instById.get(p.instanceId);
        if (!inst) continue;
        const prev = earliestPerUser.get(p.userId);
        if (!prev || inst.startAt < prev.startAt) {
          earliestPerUser.set(p.userId, inst);
        }
      }

      const notifiedUserIds: string[] = [];
      for (const [userId, inst] of earliestPerUser) {
        outbox.add(
          sessionCancelledForUser(
            userId,
            this.toRef(inst, root.template),
            safeReason,
            safeMessage,
          ),
        );
        notifiedUserIds.push(userId);
      }

      this.logger.log?.(
        `[lifecycle] cancel scope=${dto.scope} root=${root.id} cancelledInstances=${cancelledIds.length} notifiedUsers=${notifiedUserIds.length}`,
        'SessionLifecycleService',
      );

      return {
        scope: dto.scope,
        cancelledInstanceIds: cancelledIds,
        notifiedUserIds,
      };
    });

    await outbox.flush();
    return result;
  }

  // ─── RESCHEDULE (single instance) ─────────────────────────────────────

  async reschedule(
    instructorId: string,
    instanceId: string,
    dto: RescheduleInstanceDto,
  ): Promise<RescheduleResult> {
    const outbox = new NotificationOutbox(this.notifications, this.logger);

    const result = await this.sequelize.transaction(async (tx) => {
      const instance = await this.lockInstanceWithTemplate(instanceId, tx);
      this.assertOwner(instance, instructorId);

      if (instance.status !== SessionInstanceStatus.Scheduled) {
        throw new BadRequestException(apiError('session.cannotReschedule'));
      }

      const newStartAt = new Date(dto.newStartAt);
      const oldStartAt = instance.startAt;
      const durationMs = instance.endAt.getTime() - oldStartAt.getTime();
      const newEndAt = new Date(newStartAt.getTime() + durationMs);

      await instance.update(
        { startAt: newStartAt, endAt: newEndAt },
        { transaction: tx },
      );

      // Re-detect conflicts after the move.
      const conflictingInstanceIds = await this.conflictService.recomputeFor(
        instance,
        tx,
      );

      // Notify every non-terminal participant exactly once.
      const participants = await this.participantModel.findAll({
        where: {
          instanceId,
          status: {
            [Op.notIn]: [
              SessionParticipantStatus.Cancelled,
              SessionParticipantStatus.Declined,
            ],
          },
        },
        attributes: ['userId'],
        transaction: tx,
      });
      const uniq = [...new Set(participants.map((p) => p.userId))];
      const ref = this.toRef(instance, instance.template);
      for (const uid of uniq) {
        outbox.add(sessionRescheduledForUser(uid, ref, oldStartAt));
      }

      this.logger.log?.(
        `[lifecycle] reschedule instance=${instance.id} ${oldStartAt.toISOString()} -> ${newStartAt.toISOString()} notified=${uniq.length}`,
        'SessionLifecycleService',
      );

      const warnings =
        conflictingInstanceIds.length > 0
          ? [
              {
                code: 'CONFLICT' as const,
                instanceIds: conflictingInstanceIds,
              },
            ]
          : [];

      return {
        instanceId: instance.id,
        oldStartAt,
        newStartAt,
        notifiedUserIds: uniq,
        warnings,
      };
    });

    await outbox.flush();
    return result;
  }

  // ─── GROUP DELETED ────────────────────────────────────────────────────

  /**
   * A group was deleted: its members-only (GROUP_ONLY) series stop, since
   * nobody can be a member any more. For each series still running (ACTIVE,
   * or ENDED with occurrences left) the occurrences ahead are cancelled
   * with their open bookings, and an ACTIVE series becomes CANCELLED so the
   * nightly top-up makes no more. Past occurrences keep their history.
   * Open and clients-only series linked to the group carry on: anyone
   * allowed in may still book them.
   *
   * One transaction per series; one failing is logged and the rest still
   * stop. Everyone whose booking ended hears once, with the count (the
   * coach deleted the group, so they are not told). Returns the series
   * that changed, for the search index.
   */
  async cancelDeletedGroupSessions(
    groupId: string,
    groupName: string,
  ): Promise<{
    templateIds: string[];
    cancelledInstances: number;
    notifiedUserIds: string[];
  }> {
    const open = [
      SessionParticipantStatus.Confirmed,
      SessionParticipantStatus.PendingApproval,
      SessionParticipantStatus.Waitlisted,
    ];
    const series = await this.templateModel.findAll({
      where: {
        groupId,
        access: SessionAccess.GroupOnly,
        status: [SessionTemplateStatus.Active, SessionTemplateStatus.Ended],
      },
      attributes: ['id'],
    });

    const templateIds: string[] = [];
    const endedPerUser = new Map<string, number>();
    let cancelledInstances = 0;
    for (const row of series) {
      try {
        const stopped = await this.sequelize.transaction(async (tx) => {
          const template = await this.templateModel.findOne({
            where: { id: row.id },
            lock: tx.LOCK.UPDATE,
            transaction: tx,
          });
          if (!template) {
            return null;
          }
          const now = new Date();
          const ahead = await this.instanceModel.findAll({
            where: {
              templateId: template.id,
              status: SessionInstanceStatus.Scheduled,
              startAt: { [Op.gt]: now },
            },
            attributes: ['id'],
            lock: tx.LOCK.UPDATE,
            transaction: tx,
          });
          const instanceIds = ahead.map((instance) => instance.id);

          let bookedUserIds: string[] = [];
          if (instanceIds.length > 0) {
            await this.instanceModel.update(
              { status: SessionInstanceStatus.Cancelled, cancelledAt: now },
              { where: { id: instanceIds }, transaction: tx },
            );
            const booked = await this.participantModel.findAll({
              where: { instanceId: instanceIds, status: open },
              attributes: ['userId'],
              transaction: tx,
            });
            bookedUserIds = booked.map((participant) => participant.userId);
            await this.participantModel.update(
              {
                status: SessionParticipantStatus.Cancelled,
                cancelledAt: now,
                waitlistPosition: null,
              },
              {
                where: { instanceId: instanceIds, status: open },
                transaction: tx,
              },
            );
          }
          if (template.status === SessionTemplateStatus.Active) {
            await template.update(
              { status: SessionTemplateStatus.Cancelled, endedAt: now },
              { transaction: tx },
            );
          }
          return { cancelled: instanceIds.length, bookedUserIds };
        });
        if (!stopped) {
          continue;
        }
        templateIds.push(row.id);
        cancelledInstances += stopped.cancelled;
        for (const userId of stopped.bookedUserIds) {
          endedPerUser.set(userId, (endedPerUser.get(userId) ?? 0) + 1);
        }
      } catch (err) {
        this.logger.error(
          `[lifecycle] could not stop series ${row.id} of deleted group ${groupId}: ${(err as Error).message}`,
          'SessionLifecycleService',
        );
      }
    }

    // notify-after-commit: every series above has committed.
    for (const [userId, count] of endedPerUser) {
      await this.notifications
        .notify(
          groupDeletedBookingsEndedForUser(
            userId,
            { id: groupId, name: groupName },
            count,
          ),
        )
        .catch((err: Error) =>
          this.logger.error(
            `[lifecycle] notify deleted-group bookings failed for user ${userId}, group ${groupId}: ${err.message}`,
            'SessionLifecycleService',
          ),
        );
    }

    this.logger.log?.(
      `[lifecycle] deleted group ${groupId}: stopped ${templateIds.length} series, cancelled ${cancelledInstances} sessions, told ${endedPerUser.size} people`,
      'SessionLifecycleService',
    );
    return {
      templateIds,
      cancelledInstances,
      notifiedUserIds: [...endedPerUser.keys()],
    };
  }

  // ─── PATCH (per-occurrence overrides) ────────────────────────────────

  async patchInstance(
    instructorId: string,
    instanceId: string,
    dto: PatchInstanceDto,
  ): Promise<SessionInstance> {
    const outbox = new NotificationOutbox(this.notifications, this.logger);
    const result = await this.sequelize.transaction(async (tx) => {
      const instance = await this.lockInstanceWithTemplate(instanceId, tx);
      this.assertOwner(instance, instructorId);

      // Cross-resource ownership: venueId must belong to caller. Same
      // IDOR guard pattern as the template service.
      if (dto.venueIdOverride !== undefined && dto.venueIdOverride !== null) {
        await this.venueService.get(instructorId, dto.venueIdOverride);
      }

      // Capacity-shrink guard: cannot drop below currently confirmed
      // (we cannot retroactively kick people out).
      if (dto.capacityOverride !== undefined && dto.capacityOverride !== null) {
        if (dto.capacityOverride < instance.confirmedCount) {
          throw new BadRequestException(
            apiError('session.capacityBelowConfirmed', {
              count: instance.confirmedCount,
            }),
          );
        }
      }

      const updates: Partial<SessionInstance> = {};
      let anyChange = false;

      if (dto.titleOverride !== undefined) {
        updates.titleOverride =
          dto.titleOverride === null
            ? null
            : stripHtml(dto.titleOverride, 255) || null;
        anyChange = true;
      }
      if (dto.descriptionOverride !== undefined) {
        updates.descriptionOverride =
          dto.descriptionOverride === null
            ? null
            : stripHtml(dto.descriptionOverride, 4000) || null;
        anyChange = true;
      }
      if (dto.venueIdOverride !== undefined) {
        updates.venueIdOverride = dto.venueIdOverride;
        anyChange = true;
      }
      if (dto.meetingUrlOverride !== undefined) {
        updates.meetingUrlOverride = dto.meetingUrlOverride;
        anyChange = true;
      }
      if (dto.capacityOverride !== undefined) {
        updates.capacityOverride = dto.capacityOverride;
        anyChange = true;
      }

      if (anyChange) {
        // Compute "would any override field be non-null after we commit?"
        // Care: `??` falls through on null, which is wrong when the patch
        // EXPLICITLY sets a field to null (clear the override). Use the
        // patched value if the field is in `updates`, otherwise fall back
        // to the current instance value.
        const has = <K extends keyof SessionInstance>(k: K): boolean => {
          const next = (k in updates ? updates[k] : instance[k]) as unknown;
          return next !== null && next !== undefined;
        };
        updates.isOverride =
          has('titleOverride') ||
          has('descriptionOverride') ||
          has('venueIdOverride') ||
          has('meetingUrlOverride') ||
          has('capacityOverride');

        await instance.update(updates, { transaction: tx });
      }

      // A raised capacity (or a cleared override back to a larger series
      // capacity) frees seats: the oldest waitlisters move in, as when a
      // booking is cancelled. They used to stay waitlisted while the next
      // new booker took the seat.
      if (
        dto.capacityOverride !== undefined &&
        instance.status === SessionInstanceStatus.Scheduled &&
        instance.template.waitlistEnabled
      ) {
        const promoted = await this.waitlistService.promoteIntoFreeSeats(
          instance,
          tx,
        );
        if (promoted.length > 0) {
          await this.refreshCounters(instance, tx);
          const ref = this.toRef(instance, instance.template);
          for (const promo of promoted) {
            outbox.add(bookingPromotedForUser(promo.userId, ref));
          }
        }
      }

      this.logger.log?.(
        `[lifecycle] override instance=${instance.id} fields=${Object.keys(updates).join(',')}`,
        'SessionLifecycleService',
      );
      return instance;
    });

    // notify-after-commit: the people who moved off the waitlist.
    await outbox.flush();
    return result;
  }

  /**
   * After a series' capacity went up (SessionTemplateService.update): fill
   * the free seats of every future occurrence that follows the series
   * capacity (no capacity of its own) and has people waiting. One
   * transaction per occurrence, each under its lock; one failing is logged
   * and the rest still fill. Returns how many people moved in.
   */
  async promoteAfterSeriesCapacityRaise(templateId: string): Promise<number> {
    const waiting = await this.instanceModel.findAll({
      where: {
        templateId,
        status: SessionInstanceStatus.Scheduled,
        startAt: { [Op.gt]: new Date() },
        capacityOverride: null,
        waitlistedCount: { [Op.gt]: 0 },
      },
      attributes: ['id'],
      order: [['startAt', 'ASC']],
    });

    let total = 0;
    for (const row of waiting) {
      const outbox = new NotificationOutbox(this.notifications, this.logger);
      try {
        const moved = await this.sequelize.transaction(async (tx) => {
          const instance = await this.lockInstanceWithTemplate(row.id, tx);
          if (
            instance.status !== SessionInstanceStatus.Scheduled ||
            !instance.template.waitlistEnabled
          ) {
            return 0;
          }
          const promoted = await this.waitlistService.promoteIntoFreeSeats(
            instance,
            tx,
          );
          const ref = this.toRef(instance, instance.template);
          for (const promo of promoted) {
            outbox.add(bookingPromotedForUser(promo.userId, ref));
          }
          return promoted.length;
        });
        total += moved;
        await outbox.flush();
      } catch (err) {
        outbox.discard();
        this.logger.error(
          `[lifecycle] waitlist fill failed on instance=${row.id} after a series capacity raise: ${(err as Error).message}`,
          'SessionLifecycleService',
        );
      }
    }
    return total;
  }

  // ─── FOLLOW-UP (post-session blast) ──────────────────────────────────

  async followUp(
    instructorId: string,
    instanceId: string,
    dto: FollowUpDto,
  ): Promise<{ notifiedUserIds: string[] }> {
    const outbox = new NotificationOutbox(this.notifications, this.logger);

    const result = await this.sequelize.transaction(async (tx) => {
      const instance = await this.lockInstanceWithTemplate(instanceId, tx);
      this.assertOwner(instance, instructorId);

      // `all` / `userIds` work pre-session ("running late" / "venue changed"
      // announcements). `attended` / `noshow` need attendance data that
      // only exists once the session has started.
      if (
        (dto.audience === 'attended' || dto.audience === 'noshow') &&
        instance.startAt.getTime() > Date.now()
      ) {
        throw new BadRequestException(apiError('session.audienceBeforeStart'));
      }

      const safeMessage = stripHtml(dto.message, 2000);
      if (!safeMessage) {
        throw new BadRequestException(apiError('session.messageRequired'));
      }

      // Build the audience query. Skip CANCELLED/DECLINED in all cases —
      // we never message people who terminated. For `attended` we filter
      // on `attended=true`; for `noshow` on `attended=false`. The
      // `userIds` audience intersects with current participation so we
      // can't be tricked into spraying arbitrary user IDs.
      const whereBase: Record<string, unknown> = {
        instanceId,
        status: {
          [Op.notIn]: [
            SessionParticipantStatus.Cancelled,
            SessionParticipantStatus.Declined,
          ],
        },
      };
      let where: Record<string, unknown> = whereBase;
      switch (dto.audience) {
        case 'all':
          break;
        case 'attended':
          where = { ...whereBase, attended: true };
          break;
        case 'noshow':
          where = { ...whereBase, attended: false };
          break;
        case 'userIds':
          if (!dto.userIds || dto.userIds.length === 0) {
            throw new BadRequestException(
              apiError('session.recipientsRequired'),
            );
          }
          where = { ...whereBase, userId: { [Op.in]: dto.userIds } };
          break;
      }

      const participants = await this.participantModel.findAll({
        where,
        attributes: ['userId'],
        transaction: tx,
      });

      // Dedupe — `uk_sp_instance_user` guarantees uniqueness in DB, but
      // the Set is cheap insurance against future query joins.
      const uniq = [...new Set(participants.map((p) => p.userId))];
      const ref = this.toRef(instance, instance.template);
      for (const userId of uniq) {
        outbox.add(sessionFollowUpForUser(userId, ref, safeMessage));
      }

      this.logger.log?.(
        `[lifecycle] follow-up instance=${instance.id} audience=${dto.audience} notified=${uniq.length}`,
        'SessionLifecycleService',
      );

      return { notifiedUserIds: uniq };
    });

    await outbox.flush();
    return result;
  }

  // ─── helpers ──────────────────────────────────────────────────────

  private async lockInstanceWithTemplate(
    instanceId: string,
    tx: Transaction,
  ): Promise<SessionInstance> {
    const instance = await this.instanceModel.findOne({
      where: { id: instanceId },
      include: [{ model: SessionTemplate, required: true }],
      lock: tx.LOCK.UPDATE,
      transaction: tx,
    });
    if (!instance) throw new NotFoundException(apiError('session.notFound'));
    return instance;
  }

  /** Re-read the seat counters a promotion moved, so the answer is current. */
  private async refreshCounters(
    instance: SessionInstance,
    tx: Transaction,
  ): Promise<void> {
    const fresh = await this.instanceModel.findOne({
      where: { id: instance.id },
      attributes: ['confirmedCount', 'waitlistedCount'],
      transaction: tx,
    });
    if (!fresh) {
      return;
    }
    instance.setDataValue('confirmedCount', fresh.confirmedCount);
    instance.setDataValue('waitlistedCount', fresh.waitlistedCount);
  }

  private assertOwner(instance: SessionInstance, callerId: string): void {
    if (instance.instructorId !== callerId) {
      // 404 to avoid existence leak; matches the convention used elsewhere.
      throw new NotFoundException(apiError('session.notFound'));
    }
  }

  private toRef(
    instance: SessionInstance,
    template: SessionTemplate,
  ): SessionRef {
    return {
      id: instance.id,
      templateId: instance.templateId,
      title: instance.titleOverride ?? template.title,
      startAt: instance.startAt,
      timezone: template.timezone,
    };
  }
}
