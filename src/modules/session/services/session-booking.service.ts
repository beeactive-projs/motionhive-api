import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Sequelize } from 'sequelize-typescript';
import { Op, Transaction } from 'sequelize';
import { stripHtml } from '../../../common/utils/text.utils';
import { apiError } from '../../../common/i18n';
import { User } from '../../user/entities/user.entity';
import { NotificationService } from '../../notification/notification.service';
import { NotificationOutbox } from '../../notification/notification-outbox';
import { SessionInstance } from '../entities/session-instance.entity';
import { SessionParticipant } from '../entities/session-participant.entity';
import { SessionTemplate } from '../entities/session-template.entity';
import {
  SessionInstanceStatus,
  SessionParticipantStatus,
  SessionTemplateStatus,
} from '../entities/session.enums';
import { SessionAccessService } from './session-access.service';
import { SessionWaitlistService } from './session-waitlist.service';
import { BookSessionDto } from '../dto/book-session.dto';
import { CancelBookingDto } from '../dto/cancel-booking.dto';
import { DeclineParticipantDto } from '../dto/decline-participant.dto';
import { PatchParticipantDto } from '../dto/patch-participant.dto';
import {
  bookingApprovedForUser,
  bookingDeclinedForUser,
  bookingDeclinedSessionFullForUser,
  bookingPromotedForUser,
  participantJoinedForInstructor,
  participantLeftForInstructor,
  sessionBookedForUser,
  type SessionRef,
} from '../notifications';

/**
 * Booking lifecycle: book, cancel-booking, approve, decline, attendance.
 *
 * Race-condition strategy:
 *   - Every state change opens its own transaction.
 *   - Inside, we `SELECT ... FOR UPDATE` the instance row first.
 *   - Two concurrent `book` calls on a capacity=1 session: one acquires
 *     the lock, sees activeCount=0, inserts CONFIRMED, increments to 1.
 *     The second blocks on the lock; when released it sees activeCount=1
 *     and either WAITLISTs or 409s based on `waitlistEnabled`.
 *
 * Counter strategy: denormalised counters on the instance row, mutated
 * via `increment` in the same tx as the participant row. Never recompute
 * from COUNT(*) at read time. A drift-recovery script can be added later
 * if we ever see real drift (none has happened in the legacy module).
 */

export type BookingStatus =
  | 'CONFIRMED'
  | 'PENDING_APPROVAL'
  | 'WAITLISTED'
  | 'CANCELLED'
  | 'DECLINED';

export interface BookResult {
  status: BookingStatus;
  participantId: string;
}

export interface CancelBookingResult {
  status: 'CANCELLED';
  cancellation: 'WITHIN_WINDOW' | 'OUTSIDE_WINDOW';
  promotedUserId: string | null;
}

/** Mapping enum value → instance counter column. */
const COUNTER_FOR: Partial<
  Record<SessionParticipantStatus, keyof SessionInstance>
> = {
  [SessionParticipantStatus.Confirmed]: 'confirmedCount',
  [SessionParticipantStatus.PendingApproval]: 'pendingApprovalCount',
  [SessionParticipantStatus.Waitlisted]: 'waitlistedCount',
};

@Injectable()
export class SessionBookingService {
  constructor(
    @InjectModel(SessionInstance)
    private readonly instanceModel: typeof SessionInstance,
    @InjectModel(SessionParticipant)
    private readonly participantModel: typeof SessionParticipant,
    @InjectModel(SessionTemplate)
    private readonly templateModel: typeof SessionTemplate,
    @InjectModel(User)
    private readonly userModel: typeof User,
    private readonly accessService: SessionAccessService,
    private readonly waitlistService: SessionWaitlistService,
    private readonly notifications: NotificationService,
    private readonly sequelize: Sequelize,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // ─── BOOK ─────────────────────────────────────────────────────────

  async book(
    callerId: string,
    instanceId: string,
    dto: BookSessionDto,
  ): Promise<BookResult> {
    const outbox = new NotificationOutbox(this.notifications, this.logger);

    const result = await this.sequelize.transaction(async (tx) => {
      const instance = await this.lockInstanceWithTemplate(instanceId, tx);

      // Preconditions
      if (instance.instructorId === callerId) {
        throw new BadRequestException(apiError('session.cannotBookOwn'));
      }
      if (instance.template.status !== SessionTemplateStatus.Active) {
        throw new ConflictException(apiError('session.seriesNotActive'));
      }
      if (instance.status !== SessionInstanceStatus.Scheduled) {
        throw new ConflictException(apiError('session.notBookable'));
      }
      if (instance.startAt.getTime() <= Date.now()) {
        throw new ConflictException(apiError('session.alreadyStarted'));
      }

      // Access check (CLIENTS_ONLY / GROUP_ONLY)
      const access = await this.accessService.evaluate(
        instance,
        instance.template,
        callerId,
        tx,
      );
      if (!access.isEligible && !access.isParticipant) {
        throw new ForbiddenException(apiError('session.notEligible'));
      }

      // Idempotency: any non-terminal row for this user blocks re-book.
      // Terminal rows (CANCELLED / DECLINED) get reactivated in place
      // to honor the UNIQUE (instance_id, user_id) constraint.
      const existing = await this.participantModel.findOne({
        where: { instanceId, userId: callerId },
        lock: tx.LOCK.UPDATE,
        transaction: tx,
      });
      if (existing && !this.isTerminalStatus(existing.status)) {
        throw new ConflictException({
          ...apiError('session.alreadyBooked', { status: existing.status }),
          code: 'ALREADY_BOOKED',
        });
      }

      // Decide target status
      const cap = this.effectiveCapacity(instance);
      const activeCount =
        instance.confirmedCount + instance.pendingApprovalCount;
      const isFull = cap !== null && activeCount >= cap;

      let targetStatus: SessionParticipantStatus;
      if (instance.template.approvalRequired) {
        targetStatus = SessionParticipantStatus.PendingApproval;
      } else if (!isFull) {
        targetStatus = SessionParticipantStatus.Confirmed;
      } else if (instance.template.waitlistEnabled) {
        targetStatus = SessionParticipantStatus.Waitlisted;
      } else {
        throw new ConflictException({
          ...apiError('session.full'),
          code: 'CAPACITY_HIT_NO_WAITLIST',
        });
      }

      // Snapshot: terms-as-booked, immutable
      const snapshot = this.buildSnapshot(instance);
      const safeNote = dto.bookingNote
        ? stripHtml(dto.bookingNote, 500) || null
        : null;

      const now = new Date();
      let participant: SessionParticipant;

      if (existing) {
        // Reactivate the terminal row in place
        await existing.update(
          {
            status: targetStatus,
            bookingNote: safeNote,
            bookedAt: now,
            cancelledAt: null,
            declinedAt: null,
            approvedAt: null,
            cancelReason: null,
            waitlistPosition: null,
            ...snapshot,
          },
          { transaction: tx },
        );
        participant = existing;
      } else {
        participant = await this.participantModel.create(
          {
            instanceId,
            userId: callerId,
            status: targetStatus,
            bookingNote: safeNote,
            bookedAt: now,
            ...snapshot,
          },
          { transaction: tx },
        );
      }

      // Counter
      await this.incCounter(instance.id, targetStatus, +1, tx);

      // Reminders only when confirmed (waitlisted users get reminders
      // on auto-promotion in the waitlist service).
      if (targetStatus === SessionParticipantStatus.Confirmed) {
        await this.waitlistService.scheduleReminders(
          participant.id,
          instance,
          tx,
        );
      }

      // Queue notifications (flush AFTER commit so a rollback discards)
      const ref = this.toRef(instance);
      const participantName = await this.fetchUserName(callerId, tx);
      outbox.add(sessionBookedForUser(callerId, ref, { status: targetStatus }));
      outbox.add(
        participantJoinedForInstructor(
          instance.instructorId,
          participantName,
          ref,
        ),
      );

      this.logger.log?.(
        `[booking] book instance=${instance.id} user=${callerId} status=${targetStatus} participant=${participant.id}`,
        'SessionBookingService',
      );
      return { status: targetStatus, participantId: participant.id };
    });

    await outbox.flush();
    return result;
  }

  // ─── CANCEL BOOKING (by the participant themselves) ───────────────

  async cancelBooking(
    callerId: string,
    instanceId: string,
    dto: CancelBookingDto,
  ): Promise<CancelBookingResult> {
    const outbox = new NotificationOutbox(this.notifications, this.logger);

    const result = await this.sequelize.transaction(async (tx) => {
      const instance = await this.lockInstanceWithTemplate(instanceId, tx);

      // If the instance was cancelled (or any non-scheduled status), the
      // participant's row was likely already cancelled by the cancel-scope
      // logic. Still, never auto-promote into a dead instance — that would
      // create a confirmed booking on a cancelled session.
      if (instance.status !== SessionInstanceStatus.Scheduled) {
        throw new ConflictException(apiError('session.notActive'));
      }

      const participant = await this.participantModel.findOne({
        where: { instanceId, userId: callerId },
        lock: tx.LOCK.UPDATE,
        transaction: tx,
      });
      if (!participant) {
        throw new NotFoundException(apiError('session.bookingNotFound'));
      }
      if (this.isTerminalStatus(participant.status)) {
        throw new ConflictException(apiError('session.bookingAlreadyEnded'));
      }

      // Window math runs against the SNAPSHOT cutoff, not the live
      // template — terms-as-booked are immutable.
      const cutoffMs = participant.snapshotCancelCutoffH * 3_600_000;
      const withinWindow = instance.startAt.getTime() - Date.now() > cutoffMs;

      const oldStatus = participant.status;
      const safeReason = dto.reason ? stripHtml(dto.reason, 80) || null : null;

      await participant.update(
        {
          status: SessionParticipantStatus.Cancelled,
          cancelledAt: new Date(),
          cancelReason: safeReason,
          waitlistPosition: null,
        },
        { transaction: tx },
      );

      await this.incCounter(instance.id, oldStatus, -1, tx);
      await this.waitlistService.deleteRemindersFor(participant.id, tx);

      // Auto-promote only when a CONFIRMED seat was freed (waitlisted
      // and pending cancellations don't free a real seat).
      let promotedUserId: string | null = null;
      if (
        oldStatus === SessionParticipantStatus.Confirmed &&
        instance.template.waitlistEnabled
      ) {
        const promo = await this.waitlistService.tryPromote(instance, tx);
        promotedUserId = promo?.userId ?? null;
        if (promo) {
          outbox.add(
            bookingPromotedForUser(promo.userId, this.toRef(instance)),
          );
        }
      }

      const ref = this.toRef(instance);
      const cancellerName = await this.fetchUserName(callerId, tx);
      outbox.add(
        participantLeftForInstructor(instance.instructorId, cancellerName, ref),
      );

      return {
        status: 'CANCELLED' as const,
        cancellation: withinWindow
          ? ('WITHIN_WINDOW' as const)
          : ('OUTSIDE_WINDOW' as const),
        promotedUserId,
      };
    });

    await outbox.flush();
    return result;
  }

  // ─── APPROVE (instructor) ─────────────────────────────────────────

  async approve(
    instructorId: string,
    instanceId: string,
    participantId: string,
  ): Promise<{ status: SessionParticipantStatus }> {
    const outbox = new NotificationOutbox(this.notifications, this.logger);

    const status = await this.sequelize.transaction(async (tx) => {
      const instance = await this.lockInstanceWithTemplate(instanceId, tx);
      this.assertOwnerOrHide(instance, instructorId);

      const participant = await this.participantModel.findOne({
        where: { id: participantId, instanceId },
        lock: tx.LOCK.UPDATE,
        transaction: tx,
      });
      if (
        !participant ||
        participant.status !== SessionParticipantStatus.PendingApproval
      ) {
        throw new NotFoundException(
          apiError('session.pendingParticipantNotFound'),
        );
      }

      // Capacity may have shifted while pending — re-check.
      const cap = this.effectiveCapacity(instance);
      const activeCount = instance.confirmedCount; // pending → not counted as a seat
      const isFull = cap !== null && activeCount >= cap;

      const newStatus =
        isFull && instance.template.waitlistEnabled
          ? SessionParticipantStatus.Waitlisted
          : isFull
            ? // Closed waitlist + capacity hit while pending → decline path
              // (we promote silently to DECLINED so the user gets feedback).
              SessionParticipantStatus.Declined
            : SessionParticipantStatus.Confirmed;

      const now = new Date();
      await participant.update(
        {
          status: newStatus,
          approvedAt:
            newStatus === SessionParticipantStatus.Confirmed ? now : null,
          declinedAt:
            newStatus === SessionParticipantStatus.Declined ? now : null,
        },
        { transaction: tx },
      );

      // Counter: PENDING → newStatus
      await this.incCounter(
        instance.id,
        SessionParticipantStatus.PendingApproval,
        -1,
        tx,
      );
      await this.incCounter(instance.id, newStatus, +1, tx);

      if (newStatus === SessionParticipantStatus.Confirmed) {
        await this.waitlistService.scheduleReminders(
          participant.id,
          instance,
          tx,
        );
      }

      const ref = this.toRef(instance);
      if (newStatus === SessionParticipantStatus.Confirmed) {
        outbox.add(bookingApprovedForUser(participant.userId, ref));
      } else if (newStatus === SessionParticipantStatus.Declined) {
        outbox.add(bookingDeclinedSessionFullForUser(participant.userId, ref));
      }
      // (WAITLISTED case: notify with the standard booking-result message
      // since the user already had a pending row — they need to know
      // they're now waitlisted.)
      if (newStatus === SessionParticipantStatus.Waitlisted) {
        outbox.add(
          sessionBookedForUser(participant.userId, ref, { status: newStatus }),
        );
      }

      return newStatus;
    });

    await outbox.flush();
    return { status };
  }

  // ─── DECLINE (instructor) ─────────────────────────────────────────

  async decline(
    instructorId: string,
    instanceId: string,
    participantId: string,
    dto: DeclineParticipantDto,
  ): Promise<{ status: 'DECLINED' }> {
    const outbox = new NotificationOutbox(this.notifications, this.logger);

    await this.sequelize.transaction(async (tx) => {
      const instance = await this.lockInstanceWithTemplate(instanceId, tx);
      this.assertOwnerOrHide(instance, instructorId);

      const participant = await this.participantModel.findOne({
        where: { id: participantId, instanceId },
        lock: tx.LOCK.UPDATE,
        transaction: tx,
      });
      if (
        !participant ||
        participant.status !== SessionParticipantStatus.PendingApproval
      ) {
        throw new NotFoundException(
          apiError('session.pendingParticipantNotFound'),
        );
      }

      const safeReason = dto.reason ? stripHtml(dto.reason, 200) || null : null;

      await participant.update(
        {
          status: SessionParticipantStatus.Declined,
          declinedAt: new Date(),
          cancelReason: safeReason,
        },
        { transaction: tx },
      );
      await this.incCounter(
        instance.id,
        SessionParticipantStatus.PendingApproval,
        -1,
        tx,
      );

      outbox.add(
        bookingDeclinedForUser(
          participant.userId,
          this.toRef(instance),
          safeReason,
        ),
      );
    });

    await outbox.flush();
    return { status: 'DECLINED' };
  }

  // ─── SYSTEM SWEEP (jobs module) ───────────────────────────────────

  /**
   * Decline PENDING_APPROVAL bookings whose session start has already
   * passed — an instructor can't meaningfully approve someone into a
   * session that's begun. Driven by the
   * `sessions.cleanup_stale_participants` cron.
   *
   * Retry-safe + idempotent: each candidate is re-locked and its status
   * re-checked inside its own tx, so a re-run (or a concurrent approve)
   * never double-decrements the counter. Per-participant tx isolates
   * one bad row from the batch. Silent — no notification on an expiry
   * (these were never confirmed; in-app churn only).
   */
  async expireStalePendingApprovals(
    now: Date,
    limit = 500,
  ): Promise<{ expired: number }> {
    const candidates = await this.participantModel.findAll({
      where: { status: SessionParticipantStatus.PendingApproval },
      include: [
        {
          model: this.instanceModel,
          as: 'instance',
          required: true,
          where: { startAt: { [Op.lte]: now } },
          attributes: ['id'],
        },
      ],
      attributes: ['id', 'instanceId'],
      limit,
    });

    let expired = 0;
    for (const candidate of candidates) {
      const didExpire = await this.sequelize.transaction(async (tx) => {
        const participant = await this.participantModel.findOne({
          where: { id: candidate.id },
          lock: tx.LOCK.UPDATE,
          transaction: tx,
        });
        if (
          !participant ||
          participant.status !== SessionParticipantStatus.PendingApproval
        ) {
          return false; // approved/declined/cancelled since we listed it
        }
        await participant.update(
          {
            status: SessionParticipantStatus.Declined,
            declinedAt: now,
            cancelReason:
              'Auto-declined: session start passed while pending approval.',
          },
          { transaction: tx },
        );
        await this.incCounter(
          participant.instanceId,
          SessionParticipantStatus.PendingApproval,
          -1,
          tx,
        );
        return true;
      });
      if (didExpire) expired += 1;
    }

    if (expired > 0) {
      this.logger.log?.(
        `Auto-declined ${expired} stale pending booking(s)`,
        'SessionBookingService',
      );
    }
    return { expired };
  }

  // ─── PATCH PARTICIPANT (attendance + private note, instructor) ────

  async patchParticipant(
    instructorId: string,
    instanceId: string,
    participantId: string,
    dto: PatchParticipantDto,
  ): Promise<SessionParticipant> {
    return this.sequelize.transaction(async (tx) => {
      const instance = await this.lockInstanceWithTemplate(instanceId, tx);
      this.assertOwnerOrHide(instance, instructorId);

      // Attendance can only be set after the session has started — past
      // its `startAt`. Earlier marking is meaningless and surprising.
      if (
        dto.attended !== undefined &&
        instance.startAt.getTime() > Date.now()
      ) {
        throw new BadRequestException(
          apiError('session.attendanceBeforeStart'),
        );
      }

      const participant = await this.participantModel.findOne({
        where: { id: participantId, instanceId },
        lock: tx.LOCK.UPDATE,
        transaction: tx,
      });
      if (!participant) {
        throw new NotFoundException(apiError('session.participantNotFound'));
      }
      // Attendance belongs to people who had a seat: a cancelled, declined
      // or waitlisted booking marked "attended" skewed the counts.
      if (
        dto.attended !== undefined &&
        participant.status !== SessionParticipantStatus.Confirmed
      ) {
        throw new BadRequestException(
          apiError('session.attendanceConfirmedOnly'),
        );
      }

      const updates: Partial<SessionParticipant> = {};
      if (dto.attended !== undefined) {
        updates.attended = dto.attended;
      }
      if (dto.privateNote !== undefined) {
        updates.privateNote =
          dto.privateNote === null
            ? null
            : stripHtml(dto.privateNote, 2000) || null;
      }

      if (Object.keys(updates).length > 0) {
        await participant.update(updates, { transaction: tx });
      }
      return participant;
    });
  }

  // ─── helpers ──────────────────────────────────────────────────────

  /** Lock the instance row + eager-load its template in one query. */
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

  /** Hide-on-mismatch ownership check (404, not 403). */
  private assertOwnerOrHide(instance: SessionInstance, callerId: string): void {
    if (instance.instructorId !== callerId) {
      throw new NotFoundException(apiError('session.notFound'));
    }
  }

  private effectiveCapacity(instance: SessionInstance): number | null {
    return instance.capacityOverride ?? instance.template.capacity ?? null;
  }

  private async incCounter(
    instanceId: string,
    status: SessionParticipantStatus,
    delta: 1 | -1,
    tx: Transaction,
  ): Promise<void> {
    const field = COUNTER_FOR[status];
    if (!field) return; // CANCELLED / DECLINED don't carry counters
    await this.instanceModel.increment(
      { [field]: delta } as Partial<Record<keyof SessionInstance, number>>,
      { where: { id: instanceId }, transaction: tx },
    );
  }

  private isTerminalStatus(status: SessionParticipantStatus): boolean {
    return (
      status === SessionParticipantStatus.Cancelled ||
      status === SessionParticipantStatus.Declined
    );
  }

  /**
   * Capture the "as-booked" terms onto the participant row. The
   * instance's override fields beat the template's values, mirroring
   * the resolution rule the read service uses.
   */
  private buildSnapshot(
    instance: SessionInstance,
  ): Pick<
    SessionParticipant,
    | 'snapshotPriceCents'
    | 'snapshotCurrency'
    | 'snapshotCancelCutoffH'
    | 'snapshotLocationText'
    | 'snapshotMeetingUrl'
  > {
    return {
      snapshotPriceCents: instance.template.priceAmountCents,
      snapshotCurrency: instance.template.priceCurrency,
      snapshotCancelCutoffH: instance.template.cancellationCutoffHours,
      snapshotLocationText: null, // populated when venue wires through (Phase D)
      snapshotMeetingUrl:
        instance.meetingUrlOverride ?? instance.template.meetingUrl ?? null,
    };
  }

  private toRef(instance: SessionInstance): SessionRef {
    return {
      id: instance.id,
      templateId: instance.templateId,
      title: instance.titleOverride ?? instance.template.title,
      startAt: instance.startAt,
      timezone: instance.template.timezone,
    };
  }

  private async fetchUserName(
    userId: string,
    tx: Transaction,
  ): Promise<string | null> {
    const u = await this.userModel.findOne({
      where: { id: userId },
      attributes: ['firstName', 'lastName'],
      transaction: tx,
    });
    if (!u) return null;
    const composed = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
    return composed || null;
  }
}
