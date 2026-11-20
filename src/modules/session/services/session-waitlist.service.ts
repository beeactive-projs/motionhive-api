import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Transaction } from 'sequelize';
import { SessionInstance } from '../entities/session-instance.entity';
import { SessionParticipant } from '../entities/session-participant.entity';
import {
  SessionParticipantStatus,
  SessionReminderKind,
} from '../entities/session.enums';
import { SessionReminderSchedule } from '../entities/session-reminder-schedule.entity';

/**
 * Auto-promotion from WAITLISTED → CONFIRMED.
 *
 * Mindbody-style auto-add policy:
 *   1. When a confirmed seat opens (cancel-booking, decline), we look
 *      for the oldest waitlister.
 *   2. We only promote if `now < startAt - PRE_START_CUTOFF_MS`.
 *      Filling a seat 10 minutes before class with someone who can't
 *      physically arrive is worse than leaving it empty.
 *   3. The promote runs INSIDE the caller's transaction so a rollback
 *      of the cancellation also rolls back the promotion. The caller
 *      is expected to already hold a row-level lock on the instance.
 *
 * Counter consistency:
 *   - decrement `waitlistedCount`, increment `confirmedCount` atomically.
 *   - reminders rescheduled for the promoted participant.
 *
 * If no candidate exists or the cutoff has passed, returns null.
 */
const PRE_START_CUTOFF_MS = 2 * 60 * 60_000; // 2 hours

/**
 * The most seats one sweep fills: the DTO's capacity ceiling. Each
 * promotion re-reads the counters and stops at the cap or when nobody is
 * waiting, so this only bounds a loop that should never get near it.
 */
const MAX_PROMOTIONS_PER_SWEEP = 1000;

export interface PromotionResult {
  participantId: string;
  userId: string;
}

@Injectable()
export class SessionWaitlistService {
  constructor(
    @InjectModel(SessionInstance)
    private readonly instanceModel: typeof SessionInstance,
    @InjectModel(SessionParticipant)
    private readonly participantModel: typeof SessionParticipant,
    @InjectModel(SessionReminderSchedule)
    private readonly reminderModel: typeof SessionReminderSchedule,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Pop the oldest WAITLISTED participant and flip them to CONFIRMED.
   * Caller must already hold an UPDATE lock on the instance row.
   * Returns the promoted participant's identity so the caller can
   * fire a single notification.
   */
  async tryPromote(
    instance: SessionInstance,
    tx: Transaction,
  ): Promise<PromotionResult | null> {
    if (instance.startAt.getTime() <= Date.now() + PRE_START_CUTOFF_MS) {
      return null;
    }

    // Defense-in-depth: re-read the live counter to absorb whatever the
    // caller did just before us (decrement on cancel). The instance row
    // is locked FOR UPDATE by the caller, so this re-read is consistent.
    const fresh = await this.instanceModel.findOne({
      where: { id: instance.id },
      attributes: ['confirmedCount', 'capacityOverride'],
      transaction: tx,
    });
    if (!fresh) return null;

    const cap = fresh.capacityOverride ?? instance.template.capacity ?? null;
    if (cap !== null && fresh.confirmedCount >= cap) {
      this.logger.warn?.(
        `[waitlist] skipping promotion on instance=${instance.id} — confirmedCount (${fresh.confirmedCount}) >= cap (${cap})`,
        'SessionWaitlistService',
      );
      return null;
    }

    // Lock the candidate row so two concurrent cancel-bookings don't
    // promote the same waitlister twice. ORDER BY bookedAt enforces FIFO.
    const candidate = await this.participantModel.findOne({
      where: {
        instanceId: instance.id,
        status: SessionParticipantStatus.Waitlisted,
      },
      order: [['bookedAt', 'ASC']],
      lock: tx.LOCK.UPDATE,
      transaction: tx,
    });

    if (!candidate) return null;

    const now = new Date();
    await candidate.update(
      {
        status: SessionParticipantStatus.Confirmed,
        approvedAt: now,
        waitlistPosition: null,
      },
      { transaction: tx },
    );

    // Move denormalised counters in the same tx. Sequelize.literal would
    // be cheaper for a single-column ±1, but two separate `increment`
    // calls keep the audit story simple and SQL-injection-safe.
    await this.instanceModel.increment(
      { waitlistedCount: -1, confirmedCount: 1 },
      { where: { id: instance.id }, transaction: tx },
    );

    // Schedule reminders for the newly-confirmed participant. UNIQUE
    // (participant_id, kind) protects us from duplicate scheduling
    // even if a re-promotion ever happens.
    await this.scheduleReminders(candidate.id, instance, tx);

    this.logger.log?.(
      `Waitlist promoted: participant=${candidate.id} user=${candidate.userId} instance=${instance.id}`,
      'SessionWaitlistService',
    );

    return { participantId: candidate.id, userId: candidate.userId };
  }

  /**
   * Fill every seat that is free now from the waitlist, oldest first: what
   * a capacity raise owes the people waiting, who used to stay waitlisted
   * while the next new booker took the seat. Same rules as one freed seat
   * (tryPromote): nothing inside PRE_START_CUTOFF_MS, counters and
   * reminders move in the caller's transaction, and the caller must hold
   * the UPDATE lock on the instance (with its template loaded fresh, since
   * an unlimited or template capacity is read from it).
   */
  async promoteIntoFreeSeats(
    instance: SessionInstance,
    tx: Transaction,
  ): Promise<PromotionResult[]> {
    const promoted: PromotionResult[] = [];
    for (let i = 0; i < MAX_PROMOTIONS_PER_SWEEP; i++) {
      const next = await this.tryPromote(instance, tx);
      if (!next) {
        break;
      }
      promoted.push(next);
    }
    return promoted;
  }

  /**
   * Persist scheduled-reminder rows. Worker dispatches them when the
   * jobs module lands; for now these rows are written but never fire.
   * Idempotent via UNIQUE (participant_id, kind).
   */
  async scheduleReminders(
    participantId: string,
    instance: SessionInstance,
    tx: Transaction,
  ): Promise<void> {
    const startMs = instance.startAt.getTime();
    const now = Date.now();
    const wanted: { kind: SessionReminderKind; fireAt: Date }[] = [];

    const t24 = new Date(startMs - 24 * 60 * 60_000);
    const t1 = new Date(startMs - 60 * 60_000);
    if (t24.getTime() > now)
      wanted.push({ kind: SessionReminderKind.Reminder24h, fireAt: t24 });
    if (t1.getTime() > now)
      wanted.push({ kind: SessionReminderKind.Reminder1h, fireAt: t1 });

    for (const row of wanted) {
      // `upsert` honors the UNIQUE constraint on (participant_id, kind).
      // We don't worry about clobbering a sentAt — if a reminder has
      // already fired we want to leave it alone. Use raw insert with
      // ON CONFLICT DO NOTHING semantics via ignoreDuplicates.
      await this.reminderModel
        .findOrCreate({
          where: { participantId, kind: row.kind },
          defaults: {
            participantId,
            instanceId: instance.id,
            kind: row.kind,
            fireAt: row.fireAt,
          },
          transaction: tx,
        })
        .catch((err: Error) => {
          // Unique constraint races are fine — silently swallow them so
          // a concurrent re-schedule on the same participant doesn't 500.
          if (err.name === 'SequelizeUniqueConstraintError') return;
          throw err;
        });
    }
  }

  /**
   * Delete any unsent reminder rows for a participant. Called when a
   * confirmed participant cancels — keeps the reminder table small and
   * avoids dispatching a "session starts in 1h" to someone who left.
   */
  async deleteRemindersFor(
    participantId: string,
    tx: Transaction,
  ): Promise<void> {
    await this.reminderModel.destroy({
      where: { participantId, sentAt: null },
      transaction: tx,
    });
  }
}
