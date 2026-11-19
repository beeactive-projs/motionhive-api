import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Sequelize } from 'sequelize-typescript';
import { SessionBookingService } from './session-booking.service';
import { SessionAccessService } from './session-access.service';
import { SessionWaitlistService } from './session-waitlist.service';
import { SessionInstance } from '../entities/session-instance.entity';
import { SessionParticipant } from '../entities/session-participant.entity';
import { SessionTemplate } from '../entities/session-template.entity';
import { User } from '../../user/entities/user.entity';
import { NotificationService } from '../../notification/notification.service';
import {
  SessionAccess,
  SessionInstanceStatus,
  SessionParticipantStatus,
  SessionTemplateStatus,
} from '../entities/session.enums';
import { makeSilentLogger } from '../../../../test/helpers/sequelize-mocks';

// ── lightweight in-memory "tx" so service tx wrapper resolves through ──
const fakeSequelize = () => {
  const seq = {
    transaction: async <T>(
      cb: (tx: { LOCK: { UPDATE: 'UPDATE' } }) => Promise<T>,
    ) => cb({ LOCK: { UPDATE: 'UPDATE' } }),
  };
  return seq as unknown as Sequelize;
};

const future = (ms = 7 * 86_400_000) => new Date(Date.now() + ms);

// Minimal instance fixture (Plain object playing the role of Sequelize entity)
const makeInstance = (
  overrides: Partial<{
    id: string;
    instructorId: string;
    status: SessionInstanceStatus;
    startAt: Date;
    confirmedCount: number;
    pendingApprovalCount: number;
    waitlistedCount: number;
    capacityOverride: number | null;
    titleOverride: string | null;
    meetingUrlOverride: string | null;
    template: Partial<SessionTemplate>;
  }> = {},
) => ({
  id: overrides.id ?? 'inst-1',
  templateId: 'tmpl-1',
  instructorId: overrides.instructorId ?? 'usr-instr',
  status: overrides.status ?? SessionInstanceStatus.Scheduled,
  startAt: overrides.startAt ?? future(),
  confirmedCount: overrides.confirmedCount ?? 0,
  pendingApprovalCount: overrides.pendingApprovalCount ?? 0,
  waitlistedCount: overrides.waitlistedCount ?? 0,
  capacityOverride: overrides.capacityOverride ?? null,
  titleOverride: overrides.titleOverride ?? null,
  meetingUrlOverride: overrides.meetingUrlOverride ?? null,
  template: {
    id: 'tmpl-1',
    title: 'Yoga',
    status: SessionTemplateStatus.Active,
    access: SessionAccess.Open,
    instructorId: overrides.instructorId ?? 'usr-instr',
    approvalRequired: false,
    waitlistEnabled: true,
    capacity: 10,
    cancellationCutoffHours: 24,
    priceAmountCents: 0,
    priceCurrency: 'RON',
    timezone: 'Europe/Bucharest',
    meetingUrl: null,
    ...overrides.template,
  } as SessionTemplate,
});

const makeParticipant = (overrides: Partial<SessionParticipant> = {}) => {
  const data: Record<string, unknown> = {
    id: 'p-1',
    instanceId: 'inst-1',
    userId: 'usr-1',
    status: SessionParticipantStatus.Confirmed,
    snapshotCancelCutoffH: 24,
    snapshotPriceCents: 0,
    snapshotCurrency: 'RON',
    bookedAt: new Date(),
    update: jest.fn(function (
      this: Record<string, unknown>,
      u: Record<string, unknown>,
    ) {
      Object.assign(this, u);
      return Promise.resolve(this);
    }),
    ...overrides,
  };
  return data;
};

describe('SessionBookingService', () => {
  let service: SessionBookingService;
  let instanceModel: {
    findOne: jest.Mock;
    increment: jest.Mock;
    findAll: jest.Mock;
  };
  let participantModel: {
    findOne: jest.Mock;
    create: jest.Mock;
  };
  let templateModel: { findOne: jest.Mock };
  let userModel: { findOne: jest.Mock };
  let accessService: { evaluate: jest.Mock };
  let waitlistService: {
    tryPromote: jest.Mock;
    scheduleReminders: jest.Mock;
    deleteRemindersFor: jest.Mock;
  };
  let notifyService: { notify: jest.Mock };

  beforeEach(async () => {
    instanceModel = {
      findOne: jest.fn(),
      increment: jest.fn().mockResolvedValue(undefined),
      findAll: jest.fn(),
    };
    participantModel = {
      findOne: jest.fn(),
      create: jest.fn(),
    };
    templateModel = { findOne: jest.fn() };
    userModel = {
      findOne: jest
        .fn()
        .mockResolvedValue({ firstName: 'Ana', lastName: 'Pop' }),
    };
    accessService = { evaluate: jest.fn() };
    waitlistService = {
      tryPromote: jest.fn(),
      scheduleReminders: jest.fn().mockResolvedValue(undefined),
      deleteRemindersFor: jest.fn().mockResolvedValue(undefined),
    };
    notifyService = { notify: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        SessionBookingService,
        { provide: getModelToken(SessionInstance), useValue: instanceModel },
        {
          provide: getModelToken(SessionParticipant),
          useValue: participantModel,
        },
        { provide: getModelToken(SessionTemplate), useValue: templateModel },
        { provide: getModelToken(User), useValue: userModel },
        { provide: SessionAccessService, useValue: accessService },
        { provide: SessionWaitlistService, useValue: waitlistService },
        { provide: NotificationService, useValue: notifyService },
        { provide: Sequelize, useValue: fakeSequelize() },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = module.get(SessionBookingService);
  });

  // ─── BOOK ─────────────────────────────────────────────────────────

  describe('book', () => {
    it('C1: CONFIRMED when capacity available, schedules reminders, fires 2 notifications', async () => {
      instanceModel.findOne.mockResolvedValue(makeInstance());
      accessService.evaluate.mockResolvedValue({
        canView: true,
        isOwner: false,
        isParticipant: false,
        isEligible: true,
      });
      participantModel.findOne.mockResolvedValue(null);
      participantModel.create.mockResolvedValue({
        id: 'p-new',
        userId: 'usr-1',
      });

      const r = await service.book('usr-1', 'inst-1', {});

      expect(r.status).toBe('CONFIRMED');
      expect(instanceModel.increment).toHaveBeenCalledWith(
        { confirmedCount: 1 },
        expect.objectContaining({ where: { id: 'inst-1' } }),
      );
      expect(waitlistService.scheduleReminders).toHaveBeenCalledTimes(1);
      // 2 outbox events flushed → 2 notifications
      expect(notifyService.notify).toHaveBeenCalledTimes(2);
    });

    it('C2: PENDING_APPROVAL when template.approvalRequired=true', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({ template: { approvalRequired: true } }),
      );
      accessService.evaluate.mockResolvedValue({
        canView: true,
        isOwner: false,
        isParticipant: false,
        isEligible: true,
      });
      participantModel.findOne.mockResolvedValue(null);
      participantModel.create.mockResolvedValue({
        id: 'p-new',
        userId: 'usr-1',
      });

      const r = await service.book('usr-1', 'inst-1', {});
      expect(r.status).toBe('PENDING_APPROVAL');
      expect(waitlistService.scheduleReminders).not.toHaveBeenCalled();
    });

    it('C3: WAITLISTED when at capacity + waitlist enabled', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({
          confirmedCount: 10,
          template: { capacity: 10, waitlistEnabled: true },
        }),
      );
      accessService.evaluate.mockResolvedValue({
        canView: true,
        isOwner: false,
        isParticipant: false,
        isEligible: true,
      });
      participantModel.findOne.mockResolvedValue(null);
      participantModel.create.mockResolvedValue({
        id: 'p-new',
        userId: 'usr-1',
      });

      const r = await service.book('usr-1', 'inst-1', {});
      expect(r.status).toBe('WAITLISTED');
      expect(waitlistService.scheduleReminders).not.toHaveBeenCalled();
    });

    it('C4: 409 CAPACITY_HIT_NO_WAITLIST when at capacity + waitlist disabled', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({
          confirmedCount: 1,
          template: { capacity: 1, waitlistEnabled: false },
        }),
      );
      accessService.evaluate.mockResolvedValue({
        canView: true,
        isOwner: false,
        isParticipant: false,
        isEligible: true,
      });
      participantModel.findOne.mockResolvedValue(null);

      await expect(service.book('usr-1', 'inst-1', {})).rejects.toThrow(
        ConflictException,
      );
    });

    it('C5: 400 when caller is the instructor of the session', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({ instructorId: 'usr-1' }),
      );
      await expect(service.book('usr-1', 'inst-1', {})).rejects.toThrow(
        BadRequestException,
      );
      expect(participantModel.create).not.toHaveBeenCalled();
    });

    it('C6: 409 ALREADY_BOOKED when non-terminal row exists', async () => {
      instanceModel.findOne.mockResolvedValue(makeInstance());
      accessService.evaluate.mockResolvedValue({
        canView: true,
        isOwner: false,
        isParticipant: true,
        isEligible: true,
      });
      participantModel.findOne.mockResolvedValue(
        makeParticipant({
          status: SessionParticipantStatus.Confirmed as unknown as undefined,
        }),
      );
      await expect(service.book('usr-1', 'inst-1', {})).rejects.toThrow(
        ConflictException,
      );
    });

    it('C7: reactivates CANCELLED row instead of inserting (UNIQUE constraint reuse)', async () => {
      instanceModel.findOne.mockResolvedValue(makeInstance());
      accessService.evaluate.mockResolvedValue({
        canView: true,
        isOwner: false,
        isParticipant: false,
        isEligible: true,
      });
      const existing = makeParticipant({
        status: SessionParticipantStatus.Cancelled as unknown as undefined,
      });
      participantModel.findOne.mockResolvedValue(existing);

      const r = await service.book('usr-1', 'inst-1', {});

      expect(participantModel.create).not.toHaveBeenCalled();
      expect((existing as { update: jest.Mock }).update).toHaveBeenCalled();
      expect(r.status).toBe('CONFIRMED');
    });

    it('C8 (race, mock-serialised): two simultaneous bookings on capacity=1 — second sees the new count', async () => {
      // NOTE: this is NOT a true concurrency test — Jest mocks resolve
      // synchronously. We instead simulate the SERIALISED order that
      // `SELECT ... FOR UPDATE` produces in real Postgres. A real
      // concurrency check requires a DB integration test (Phase A→G
      // unit tests do not exercise lock semantics, only their use).
      let confirmed = 0;
      instanceModel.findOne.mockImplementation(() =>
        Promise.resolve(
          makeInstance({
            confirmedCount: confirmed,
            template: { capacity: 1, waitlistEnabled: true },
          }),
        ),
      );
      // The increment side-effect updates our shared counter so the
      // next findOne sees it (mirrors what FOR UPDATE serializes).
      instanceModel.increment.mockImplementation(
        (fields: Record<string, number>) => {
          confirmed += fields['confirmedCount'] ?? 0;
          return Promise.resolve();
        },
      );
      accessService.evaluate.mockResolvedValue({
        canView: true,
        isOwner: false,
        isParticipant: false,
        isEligible: true,
      });
      participantModel.findOne.mockResolvedValue(null);
      participantModel.create.mockImplementation(
        (p: Record<string, unknown>) => {
          const userId = String(p['userId']);
          return Promise.resolve({ id: `p-${userId}`, userId });
        },
      );

      // Execute sequentially — the in-memory fake mirrors the SERIALIZED
      // behavior of a real lock (the production code holds FOR UPDATE
      // across the read-decide-write window).
      const r1 = await service.book('usr-1', 'inst-1', {});
      const r2 = await service.book('usr-2', 'inst-1', {});

      expect(r1.status).toBe('CONFIRMED');
      expect(r2.status).toBe('WAITLISTED');
    });

    it('C9: blocks booking past startAt', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({ startAt: new Date(Date.now() - 60_000) }),
      );
      await expect(service.book('usr-1', 'inst-1', {})).rejects.toThrow(
        ConflictException,
      );
    });

    it('C9b: blocks booking when template status not ACTIVE', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({ template: { status: SessionTemplateStatus.Cancelled } }),
      );
      await expect(service.book('usr-1', 'inst-1', {})).rejects.toThrow(
        ConflictException,
      );
    });

    it('C9c: blocks booking when instance status not SCHEDULED', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({ status: SessionInstanceStatus.Cancelled }),
      );
      await expect(service.book('usr-1', 'inst-1', {})).rejects.toThrow(
        ConflictException,
      );
    });

    it('C9d: 403 when access kind rejects caller (CLIENTS_ONLY non-client)', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({ template: { access: SessionAccess.ClientsOnly } }),
      );
      accessService.evaluate.mockResolvedValue({
        canView: false,
        isOwner: false,
        isParticipant: false,
        isEligible: false,
      });
      participantModel.findOne.mockResolvedValue(null);
      await expect(service.book('usr-1', 'inst-1', {})).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('strips HTML from bookingNote', async () => {
      instanceModel.findOne.mockResolvedValue(makeInstance());
      accessService.evaluate.mockResolvedValue({
        canView: true,
        isOwner: false,
        isParticipant: false,
        isEligible: true,
      });
      participantModel.findOne.mockResolvedValue(null);
      participantModel.create.mockResolvedValue({
        id: 'p-new',
        userId: 'usr-1',
      });

      await service.book('usr-1', 'inst-1', {
        bookingNote: "<script>alert('x')</script>Hello",
      });
      const createArgs = participantModel.create.mock.calls[0][0] as {
        bookingNote: string;
      };
      expect(createArgs.bookingNote).not.toContain('<script>');
      expect(createArgs.bookingNote).toBe('Hello');
    });
  });

  // ─── CANCEL BOOKING ──────────────────────────────────────────────

  describe('cancelBooking', () => {
    it('C10: within-window flag is true when startAt - cutoff > now', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({ startAt: future(48 * 3_600_000) }), // 48h ahead
      );
      participantModel.findOne.mockResolvedValue(
        makeParticipant({
          status: SessionParticipantStatus.Confirmed,
          snapshotCancelCutoffH: 24,
        }),
      );

      const r = await service.cancelBooking('usr-1', 'inst-1', {});
      expect(r.cancellation).toBe('WITHIN_WINDOW');
      expect(r.promotedUserId).toBeNull();
    });

    it('C10b: outside-window flag is true when within cutoff window', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({ startAt: future(60_000) }), // 1 min ahead
      );
      participantModel.findOne.mockResolvedValue(
        makeParticipant({ snapshotCancelCutoffH: 24 }),
      );

      const r = await service.cancelBooking('usr-1', 'inst-1', {});
      expect(r.cancellation).toBe('OUTSIDE_WINDOW');
    });

    it('C11: auto-promotes oldest waitlister when CONFIRMED seat freed', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({ startAt: future(24 * 3_600_000) }),
      );
      participantModel.findOne.mockResolvedValue(makeParticipant());
      waitlistService.tryPromote.mockResolvedValue({
        participantId: 'p-wl',
        userId: 'usr-promoted',
      });

      const r = await service.cancelBooking('usr-1', 'inst-1', {});
      expect(r.promotedUserId).toBe('usr-promoted');
      // Expect 2 notifications: instructor + promoted user
      expect(notifyService.notify).toHaveBeenCalledTimes(2);
    });

    it('C12: does NOT auto-promote when the cancelled row was WAITLISTED', async () => {
      instanceModel.findOne.mockResolvedValue(makeInstance());
      participantModel.findOne.mockResolvedValue(
        makeParticipant({ status: SessionParticipantStatus.Waitlisted }),
      );

      await service.cancelBooking('usr-1', 'inst-1', {});
      expect(waitlistService.tryPromote).not.toHaveBeenCalled();
    });

    it('C12b: snapshot cutoff (not template) drives the window math', async () => {
      // Template later changed cutoff to 0, but the snapshot says 24h.
      // 1h before start → still WITHIN_WINDOW because snapshot=24h.
      instanceModel.findOne.mockResolvedValue(
        makeInstance({
          startAt: future(3_600_000),
          template: { cancellationCutoffHours: 0 },
        }),
      );
      participantModel.findOne.mockResolvedValue(
        makeParticipant({ snapshotCancelCutoffH: 24 }),
      );
      const r = await service.cancelBooking('usr-1', 'inst-1', {});
      expect(r.cancellation).toBe('OUTSIDE_WINDOW');
    });

    it('C13: deletes unsent reminders for cancelled participant', async () => {
      instanceModel.findOne.mockResolvedValue(makeInstance());
      participantModel.findOne.mockResolvedValue(makeParticipant());

      await service.cancelBooking('usr-1', 'inst-1', {});
      expect(waitlistService.deleteRemindersFor).toHaveBeenCalled();
    });

    it('NotFound when booking missing', async () => {
      instanceModel.findOne.mockResolvedValue(makeInstance());
      participantModel.findOne.mockResolvedValue(null);
      await expect(
        service.cancelBooking('usr-1', 'inst-1', {}),
      ).rejects.toThrow(NotFoundException);
    });

    it('AUDIT FIX (B3): refuses to cancel into a non-SCHEDULED instance', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({ status: SessionInstanceStatus.Cancelled }),
      );
      await expect(
        service.cancelBooking('usr-1', 'inst-1', {}),
      ).rejects.toThrow(ConflictException);
      // Critical: tryPromote was NOT called — no waitlister gets
      // promoted into a dead session.
      expect(waitlistService.tryPromote).not.toHaveBeenCalled();
    });
  });

  // ─── APPROVE ──────────────────────────────────────────────────────

  describe('approve', () => {
    it('C14: PENDING → CONFIRMED when seats available; schedules reminders', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({ instructorId: 'usr-instr', pendingApprovalCount: 1 }),
      );
      participantModel.findOne.mockResolvedValue(
        makeParticipant({
          status: SessionParticipantStatus.PendingApproval,
          userId: 'usr-2',
        }),
      );

      const r = await service.approve('usr-instr', 'inst-1', 'p-1');
      expect(r.status).toBe(SessionParticipantStatus.Confirmed);
      expect(waitlistService.scheduleReminders).toHaveBeenCalled();
    });

    it('C14b: PENDING → WAITLISTED when capacity hit since pending was created (waitlist enabled)', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({
          confirmedCount: 10,
          pendingApprovalCount: 1,
          template: { capacity: 10, waitlistEnabled: true },
        }),
      );
      participantModel.findOne.mockResolvedValue(
        makeParticipant({ status: SessionParticipantStatus.PendingApproval }),
      );
      const r = await service.approve('usr-instr', 'inst-1', 'p-1');
      expect(r.status).toBe(SessionParticipantStatus.Waitlisted);
    });

    it('C14c: PENDING → DECLINED when capacity hit + waitlist disabled', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({
          confirmedCount: 10,
          pendingApprovalCount: 1,
          template: { capacity: 10, waitlistEnabled: false },
        }),
      );
      participantModel.findOne.mockResolvedValue(
        makeParticipant({ status: SessionParticipantStatus.PendingApproval }),
      );
      const r = await service.approve('usr-instr', 'inst-1', 'p-1');
      expect(r.status).toBe(SessionParticipantStatus.Declined);
    });

    it('404 for cross-instructor (no existence leak)', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({ instructorId: 'usr-instr' }),
      );
      await expect(
        service.approve('usr-other', 'inst-1', 'p-1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('404 when participant is not PENDING_APPROVAL', async () => {
      instanceModel.findOne.mockResolvedValue(makeInstance());
      participantModel.findOne.mockResolvedValue(
        makeParticipant({ status: SessionParticipantStatus.Confirmed }),
      );
      await expect(
        service.approve('usr-instr', 'inst-1', 'p-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── DECLINE ──────────────────────────────────────────────────────

  describe('decline', () => {
    it('C15: PENDING → DECLINED, notifies user', async () => {
      instanceModel.findOne.mockResolvedValue(makeInstance());
      participantModel.findOne.mockResolvedValue(
        makeParticipant({
          status: SessionParticipantStatus.PendingApproval,
          userId: 'usr-2',
        }),
      );
      const r = await service.decline('usr-instr', 'inst-1', 'p-1', {
        reason: 'Wrong time',
      });
      expect(r.status).toBe('DECLINED');
      expect(notifyService.notify).toHaveBeenCalledTimes(1);
    });

    it('strips HTML from decline reason', async () => {
      instanceModel.findOne.mockResolvedValue(makeInstance());
      const p = makeParticipant({
        status: SessionParticipantStatus.PendingApproval,
      });
      participantModel.findOne.mockResolvedValue(p);
      await service.decline('usr-instr', 'inst-1', 'p-1', {
        reason: '<b>busy</b>',
      });
      const updateArgs = (p as { update: jest.Mock }).update.mock
        .calls[0][0] as { cancelReason: string };
      expect(updateArgs.cancelReason).toBe('busy');
    });
  });

  // ─── PATCH PARTICIPANT ────────────────────────────────────────────

  describe('patchParticipant', () => {
    it('C16: blocks attended marking before session starts', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({ startAt: future(3_600_000) }),
      );
      participantModel.findOne.mockResolvedValue(makeParticipant());
      await expect(
        service.patchParticipant('usr-instr', 'inst-1', 'p-1', {
          attended: true,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('C16b: allows attended marking after session starts', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({ startAt: new Date(Date.now() - 60_000) }),
      );
      const p = makeParticipant();
      participantModel.findOne.mockResolvedValue(p);
      await service.patchParticipant('usr-instr', 'inst-1', 'p-1', {
        attended: true,
      });
      expect((p as { update: jest.Mock }).update).toHaveBeenCalledWith(
        expect.objectContaining({ attended: true }),
        expect.anything(),
      );
    });

    it('refuses to mark attendance for someone without a confirmed place', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({ startAt: new Date(Date.now() - 60_000) }),
      );
      const p = makeParticipant({ status: SessionParticipantStatus.Cancelled });
      participantModel.findOne.mockResolvedValue(p);

      await expect(
        service.patchParticipant('usr-instr', 'inst-1', 'p-1', {
          attended: true,
        }),
      ).rejects.toThrow(BadRequestException);
      expect((p as { update: jest.Mock }).update).not.toHaveBeenCalled();
    });

    it('C17: 404 when caller is not the instructor (no leak)', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({ instructorId: 'usr-instr' }),
      );
      await expect(
        service.patchParticipant('usr-other', 'inst-1', 'p-1', {
          privateNote: 'hi',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('strips HTML from privateNote', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({ startAt: new Date(Date.now() - 60_000) }),
      );
      const p = makeParticipant();
      participantModel.findOne.mockResolvedValue(p);
      await service.patchParticipant('usr-instr', 'inst-1', 'p-1', {
        privateNote: '<script>x</script>secret',
      });
      const u = (p as { update: jest.Mock }).update.mock.calls[0][0] as {
        privateNote: string;
      };
      expect(u.privateNote).toBe('secret');
    });

    it('accepts explicit null to clear privateNote', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInstance({ startAt: new Date(Date.now() - 60_000) }),
      );
      const p = makeParticipant();
      participantModel.findOne.mockResolvedValue(p);
      await service.patchParticipant('usr-instr', 'inst-1', 'p-1', {
        privateNote: null,
      });
      const u = (p as { update: jest.Mock }).update.mock.calls[0][0] as {
        privateNote: string | null;
      };
      expect(u.privateNote).toBeNull();
    });
  });
});
