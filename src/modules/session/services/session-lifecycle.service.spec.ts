import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SessionLifecycleService } from './session-lifecycle.service';
import { SessionConflictService } from './session-conflict.service';
import { SessionWaitlistService } from './session-waitlist.service';
import { SessionInstance } from '../entities/session-instance.entity';
import { SessionParticipant } from '../entities/session-participant.entity';
import { SessionTemplate } from '../entities/session-template.entity';
import { VenueService } from '../../venue/venue.service';
import { NotificationService } from '../../notification/notification.service';
import {
  SessionInstanceStatus,
  SessionParticipantStatus,
  SessionTemplateStatus,
} from '../entities/session.enums';
import { makeSilentLogger } from '../../../../test/helpers/sequelize-mocks';
import { notificationText } from '../../../../test/helpers/notification-text';

const fakeSequelize = () =>
  ({
    transaction: async <T>(
      cb: (tx: { LOCK: { UPDATE: 'UPDATE' } }) => Promise<T>,
    ) => cb({ LOCK: { UPDATE: 'UPDATE' } }),
  }) as unknown as Sequelize;

const future = (ms = 7 * 86_400_000) => new Date(Date.now() + ms);

const makeInst = (
  o: Partial<{
    id: string;
    instructorId: string;
    templateId: string;
    status: SessionInstanceStatus;
    startAt: Date;
    endAt: Date;
    confirmedCount: number;
    titleOverride: string | null;
    descriptionOverride: string | null;
    venueIdOverride: string | null;
    meetingUrlOverride: string | null;
    capacityOverride: number | null;
    isOverride: boolean;
    template: Partial<SessionTemplate>;
  }> = {},
) => {
  const startAt = o.startAt ?? future();
  const endAt = o.endAt ?? new Date(startAt.getTime() + 60 * 60_000);
  const data = {
    id: o.id ?? 'inst-1',
    templateId: o.templateId ?? 'tmpl-1',
    instructorId: o.instructorId ?? 'usr-instr',
    status: o.status ?? SessionInstanceStatus.Scheduled,
    startAt,
    endAt,
    confirmedCount: o.confirmedCount ?? 0,
    titleOverride: o.titleOverride ?? null,
    descriptionOverride: o.descriptionOverride ?? null,
    venueIdOverride: o.venueIdOverride ?? null,
    meetingUrlOverride: o.meetingUrlOverride ?? null,
    capacityOverride: o.capacityOverride ?? null,
    isOverride: o.isOverride ?? false,
    template: {
      id: 'tmpl-1',
      title: 'Yoga',
      timezone: 'Europe/Bucharest',
      status: SessionTemplateStatus.Active,
      update: jest.fn().mockResolvedValue(undefined),
      ...o.template,
    } as unknown as SessionTemplate,
    update: jest.fn(function (
      this: Record<string, unknown>,
      u: Record<string, unknown>,
    ) {
      Object.assign(this, u);
      return Promise.resolve(this);
    }),
  };
  return data;
};

describe('SessionLifecycleService', () => {
  let service: SessionLifecycleService;
  let instanceModel: {
    findOne: jest.Mock;
    findAll: jest.Mock;
    update: jest.Mock;
  };
  let participantModel: { findAll: jest.Mock; update: jest.Mock };
  let templateModel: { findOne: jest.Mock; findAll: jest.Mock };
  let conflictService: { recomputeFor: jest.Mock };
  let venueService: { get: jest.Mock };
  let notifyService: { notify: jest.Mock };
  let waitlistService: { promoteIntoFreeSeats: jest.Mock };

  beforeEach(async () => {
    instanceModel = {
      findOne: jest.fn(),
      findAll: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue([0]),
    };
    participantModel = {
      findAll: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue([0]),
    };
    templateModel = {
      findOne: jest.fn(),
      findAll: jest.fn().mockResolvedValue([]),
    };
    conflictService = { recomputeFor: jest.fn().mockResolvedValue([]) };
    venueService = { get: jest.fn().mockResolvedValue({ id: 'v' }) };
    notifyService = { notify: jest.fn().mockResolvedValue(undefined) };
    waitlistService = { promoteIntoFreeSeats: jest.fn().mockResolvedValue([]) };

    const module = await Test.createTestingModule({
      providers: [
        SessionLifecycleService,
        { provide: getModelToken(SessionInstance), useValue: instanceModel },
        {
          provide: getModelToken(SessionParticipant),
          useValue: participantModel,
        },
        { provide: getModelToken(SessionTemplate), useValue: templateModel },
        { provide: SessionConflictService, useValue: conflictService },
        { provide: VenueService, useValue: venueService },
        { provide: SessionWaitlistService, useValue: waitlistService },
        { provide: NotificationService, useValue: notifyService },
        { provide: Sequelize, useValue: fakeSequelize() },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = module.get(SessionLifecycleService);
  });

  // ─── CANCEL ───────────────────────────────────────────────────────

  describe('cancel', () => {
    it('D1: scope=this cancels only this instance', async () => {
      const root = makeInst();
      instanceModel.findOne.mockResolvedValue(root);
      participantModel.findAll.mockResolvedValue([
        { id: 'p-1', userId: 'usr-a', instanceId: 'inst-1' },
      ]);

      const r = await service.cancel('usr-instr', 'inst-1', { scope: 'this' });
      expect(r.cancelledInstanceIds).toEqual(['inst-1']);
      // Did NOT load siblings — scope=this skips the sibling query.
      expect(instanceModel.findAll).not.toHaveBeenCalled();
    });

    it('D2: scope=thisAndFuture cancels root + future siblings, leaves past alone', async () => {
      const root = makeInst({ id: 'root', startAt: future(7 * 86_400_000) });
      instanceModel.findOne.mockResolvedValue(root);
      // future siblings (root inclusive in the query result)
      const sib2 = makeInst({ id: 'sib-2', startAt: future(8 * 86_400_000) });
      const sib3 = makeInst({ id: 'sib-3', startAt: future(9 * 86_400_000) });
      instanceModel.findAll.mockResolvedValue([root, sib2, sib3]);
      participantModel.findAll.mockResolvedValue([
        { id: 'p-1', userId: 'usr-a', instanceId: 'root' },
        { id: 'p-2', userId: 'usr-a', instanceId: 'sib-2' }, // same user, 2 sessions
        { id: 'p-3', userId: 'usr-b', instanceId: 'sib-3' },
      ]);

      const r = await service.cancel('usr-instr', 'root', {
        scope: 'thisAndFuture',
      });
      expect(r.cancelledInstanceIds.sort()).toEqual(['root', 'sib-2', 'sib-3']);
      // D4: 2 unique users → 2 notifications (not 3 even though 3 participant rows)
      expect(r.notifiedUserIds.sort()).toEqual(['usr-a', 'usr-b']);
      expect(notifyService.notify).toHaveBeenCalledTimes(2);
    });

    it('ends the series before a this-and-later cancel, so the nightly top-up adds nothing after it', async () => {
      const templateUpdate = jest.fn().mockResolvedValue(undefined);
      const root = makeInst({
        id: 'root',
        // 18:00 on Tuesday 16 June in Bucharest.
        startAt: new Date('2026-06-16T15:00:00Z'),
        template: {
          update: templateUpdate,
          recurrenceRule: {
            frequency: 'WEEKLY',
            interval: 1,
            daysOfWeek: [2],
            endAfterOccurrences: 20,
          },
        } as Partial<SessionTemplate>,
      });
      instanceModel.findOne.mockResolvedValue(root);
      instanceModel.findAll.mockResolvedValue([root]);

      await service.cancel('usr-instr', 'root', { scope: 'thisAndFuture' });

      expect(templateUpdate).toHaveBeenCalledWith(
        {
          recurrenceRule: {
            frequency: 'WEEKLY',
            interval: 1,
            daysOfWeek: [2],
            endDate: '2026-06-15',
          },
        },
        expect.anything(),
      );
    });

    it('D3: scope=series cancels template + future instances', async () => {
      const root = makeInst();
      instanceModel.findOne.mockResolvedValue(root);
      instanceModel.findAll.mockResolvedValue([root]);

      await service.cancel('usr-instr', 'inst-1', { scope: 'series' });

      // Template was updated to CANCELLED
      expect(
        (root.template as unknown as { update: jest.Mock }).update,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ status: SessionTemplateStatus.Cancelled }),
        expect.anything(),
      );
    });

    it('D4: notification fan-out uses DISTINCT user (one msg per user)', async () => {
      const root = makeInst();
      instanceModel.findOne.mockResolvedValue(root);
      instanceModel.findAll.mockResolvedValue([root]);
      participantModel.findAll.mockResolvedValue([
        { id: 'p-1', userId: 'usr-a', instanceId: 'inst-1' },
        { id: 'p-2', userId: 'usr-a', instanceId: 'inst-1' }, // duplicate from race
        { id: 'p-3', userId: 'usr-b', instanceId: 'inst-1' },
      ]);
      const r = await service.cancel('usr-instr', 'inst-1', {
        scope: 'thisAndFuture',
      });
      expect(r.notifiedUserIds.sort()).toEqual(['usr-a', 'usr-b']);
    });

    it('404 for cross-instructor (no existence leak)', async () => {
      const root = makeInst({ instructorId: 'usr-instr' });
      instanceModel.findOne.mockResolvedValue(root);
      await expect(
        service.cancel('usr-other', 'inst-1', { scope: 'this' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('AUDIT FIX (D2): refuses to cancel a non-SCHEDULED root', async () => {
      const root = makeInst({ status: SessionInstanceStatus.Cancelled });
      instanceModel.findOne.mockResolvedValue(root);
      await expect(
        service.cancel('usr-instr', 'inst-1', { scope: 'this' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('strips HTML from reason and message', async () => {
      const root = makeInst();
      instanceModel.findOne.mockResolvedValue(root);
      participantModel.findAll.mockResolvedValue([
        { id: 'p', userId: 'u', instanceId: 'inst-1' },
      ]);
      await service.cancel('usr-instr', 'inst-1', {
        scope: 'this',
        reason: '<b>sick</b>',
        message: '<script>x</script>be back next week',
      });
      // Captured by checking the notification payload
      const payload = notificationText(notifyService.notify.mock.calls[0][0]);
      expect(payload.body).toContain('sick');
      expect(payload.body).not.toContain('<script>');
    });
  });

  // ─── RESCHEDULE ───────────────────────────────────────────────────

  describe('reschedule', () => {
    it('D5: preserves duration; notifies non-terminal participants once each', async () => {
      const start = future(7 * 86_400_000);
      const inst = makeInst({
        startAt: start,
        endAt: new Date(start.getTime() + 90 * 60_000), // 90 min
      });
      instanceModel.findOne.mockResolvedValue(inst);
      participantModel.findAll.mockResolvedValue([
        { userId: 'usr-a' },
        { userId: 'usr-a' }, // dup
        { userId: 'usr-b' },
      ]);

      const newStartIso = new Date(
        start.getTime() + 24 * 3_600_000,
      ).toISOString();
      const r = await service.reschedule('usr-instr', 'inst-1', {
        newStartAt: newStartIso,
      });

      // Duration check: endAt = newStartAt + 90min
      const newEnd = (inst.update as jest.Mock).mock.calls[0][0].endAt as Date;
      const newStart = (inst.update as jest.Mock).mock.calls[0][0]
        .startAt as Date;
      expect(newEnd.getTime() - newStart.getTime()).toBe(90 * 60_000);
      // De-duped notifications
      expect(r.notifiedUserIds.sort()).toEqual(['usr-a', 'usr-b']);
      expect(notifyService.notify).toHaveBeenCalledTimes(2);
    });

    it('D5b: surfaces conflicts in warnings array (non-blocking)', async () => {
      const inst = makeInst();
      instanceModel.findOne.mockResolvedValue(inst);
      conflictService.recomputeFor.mockResolvedValue(['conflict-1']);
      const r = await service.reschedule('usr-instr', 'inst-1', {
        newStartAt: future(8 * 86_400_000).toISOString(),
      });
      expect(r.warnings).toEqual([
        { code: 'CONFLICT', instanceIds: ['conflict-1'] },
      ]);
    });

    it('refuses to reschedule non-SCHEDULED instance', async () => {
      const inst = makeInst({ status: SessionInstanceStatus.Cancelled });
      instanceModel.findOne.mockResolvedValue(inst);
      await expect(
        service.reschedule('usr-instr', 'inst-1', {
          newStartAt: future(8 * 86_400_000).toISOString(),
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── PATCH (overrides) ────────────────────────────────────────────

  describe('patchInstance', () => {
    it('moves the waitlist into the seats a raised capacity frees, and tells each person', async () => {
      const inst = makeInst({
        confirmedCount: 5,
        capacityOverride: 5,
        template: { waitlistEnabled: true },
      });
      instanceModel.findOne
        .mockResolvedValueOnce(inst)
        .mockResolvedValueOnce({ confirmedCount: 7, waitlistedCount: 1 });
      waitlistService.promoteIntoFreeSeats.mockResolvedValue([
        { participantId: 'p-1', userId: 'usr-a' },
        { participantId: 'p-2', userId: 'usr-b' },
      ]);
      const setDataValue = jest.fn();
      Object.assign(inst, { setDataValue });

      await service.patchInstance('usr-instr', 'inst-1', {
        capacityOverride: 7,
      });

      expect(waitlistService.promoteIntoFreeSeats).toHaveBeenCalledWith(
        inst,
        expect.anything(),
      );
      expect(setDataValue).toHaveBeenCalledWith('confirmedCount', 7);
      expect(setDataValue).toHaveBeenCalledWith('waitlistedCount', 1);
      const told = notifyService.notify.mock.calls.map(
        (c: [{ userId: string; message: { key: string } }]) => [
          c[0].userId,
          c[0].message.key,
        ],
      );
      expect(told).toEqual([
        ['usr-a', 'session.bookingPromoted'],
        ['usr-b', 'session.bookingPromoted'],
      ]);
    });

    it('moves nobody when the session has no waitlist, or the patch is not about capacity', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInst({ template: { waitlistEnabled: false } }),
      );
      await service.patchInstance('usr-instr', 'inst-1', {
        capacityOverride: 20,
      });
      instanceModel.findOne.mockResolvedValue(
        makeInst({ template: { waitlistEnabled: true } }),
      );
      await service.patchInstance('usr-instr', 'inst-1', {
        titleOverride: 'New title',
      });
      expect(waitlistService.promoteIntoFreeSeats).not.toHaveBeenCalled();
      expect(notifyService.notify).not.toHaveBeenCalled();
    });

    it('moves nobody into a session that is no longer scheduled', async () => {
      instanceModel.findOne.mockResolvedValue(
        makeInst({
          status: SessionInstanceStatus.Completed,
          template: { waitlistEnabled: true },
        }),
      );
      await service.patchInstance('usr-instr', 'inst-1', {
        capacityOverride: 20,
      });
      expect(waitlistService.promoteIntoFreeSeats).not.toHaveBeenCalled();
    });

    it('D6: rejects capacityOverride below confirmedCount', async () => {
      const inst = makeInst({ confirmedCount: 5 });
      instanceModel.findOne.mockResolvedValue(inst);
      await expect(
        service.patchInstance('usr-instr', 'inst-1', { capacityOverride: 3 }),
      ).rejects.toThrow(BadRequestException);
    });

    it('D6b: accepts capacityOverride == confirmedCount (boundary)', async () => {
      const inst = makeInst({ confirmedCount: 5 });
      instanceModel.findOne.mockResolvedValue(inst);
      await expect(
        service.patchInstance('usr-instr', 'inst-1', { capacityOverride: 5 }),
      ).resolves.toBeDefined();
    });

    it('D6c: IDOR — foreign venueIdOverride is rejected (VenueService throws 404)', async () => {
      const inst = makeInst();
      instanceModel.findOne.mockResolvedValue(inst);
      venueService.get.mockRejectedValue(
        new NotFoundException('Venue not found.'),
      );
      await expect(
        service.patchInstance('usr-instr', 'inst-1', {
          venueIdOverride: 'foreign-venue',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('D9: override only affects this instance (no sibling write)', async () => {
      const inst = makeInst();
      instanceModel.findOne.mockResolvedValue(inst);
      await service.patchInstance('usr-instr', 'inst-1', {
        titleOverride: 'Custom title',
      });
      // No bulk update to siblings.
      expect(instanceModel.update).not.toHaveBeenCalled();
    });

    it('strips HTML from titleOverride and descriptionOverride', async () => {
      const inst = makeInst();
      instanceModel.findOne.mockResolvedValue(inst);
      await service.patchInstance('usr-instr', 'inst-1', {
        titleOverride: '<script>x</script>Title',
        descriptionOverride: '<b>strong</b> desc',
      });
      const updates = (inst.update as jest.Mock).mock.calls[0][0] as {
        titleOverride: string;
        descriptionOverride: string;
      };
      expect(updates.titleOverride).toBe('Title');
      expect(updates.descriptionOverride).toBe('strong desc');
    });

    it('isOverride toggles correctly when all overrides are null', async () => {
      const inst = makeInst({
        titleOverride: 'old',
        isOverride: true,
      });
      instanceModel.findOne.mockResolvedValue(inst);
      await service.patchInstance('usr-instr', 'inst-1', {
        titleOverride: null,
      });
      const updates = (inst.update as jest.Mock).mock.calls[0][0] as {
        isOverride: boolean;
      };
      expect(updates.isOverride).toBe(false);
    });

    it('404 for cross-instructor patch', async () => {
      const inst = makeInst({ instructorId: 'usr-instr' });
      instanceModel.findOne.mockResolvedValue(inst);
      await expect(
        service.patchInstance('usr-other', 'inst-1', { titleOverride: 'x' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ─── FOLLOW-UP (Phase G) ──────────────────────────────────────────

  describe('cancelDeletedGroupSessions', () => {
    const seriesRow = (id: string, status: SessionTemplateStatus) => ({
      id,
      status,
      update: jest.fn().mockResolvedValue(undefined),
    });

    it('stops the group’s members-only series and tells each booked person once', async () => {
      const active = seriesRow('tmpl-a', SessionTemplateStatus.Active);
      const ended = seriesRow('tmpl-e', SessionTemplateStatus.Ended);
      templateModel.findAll.mockResolvedValue([
        { id: 'tmpl-a' },
        { id: 'tmpl-e' },
      ]);
      templateModel.findOne.mockImplementation((q: { where: { id: string } }) =>
        Promise.resolve(q.where.id === 'tmpl-a' ? active : ended),
      );
      instanceModel.findAll
        .mockResolvedValueOnce([{ id: 'i-1' }, { id: 'i-2' }])
        .mockResolvedValueOnce([{ id: 'i-9' }]);
      participantModel.findAll
        .mockResolvedValueOnce([
          { userId: 'usr-a' },
          { userId: 'usr-a' },
          { userId: 'usr-b' },
        ])
        .mockResolvedValueOnce([{ userId: 'usr-b' }]);

      const result = await service.cancelDeletedGroupSessions(
        'group-1',
        'Runners',
      );

      const seriesQuery = (
        templateModel.findAll.mock.calls[0] as [
          { where: Record<string, unknown> },
        ]
      )[0].where;
      expect(seriesQuery).toEqual({
        groupId: 'group-1',
        access: 'GROUP_ONLY',
        status: [SessionTemplateStatus.Active, SessionTemplateStatus.Ended],
      });
      expect(instanceModel.update).toHaveBeenCalledWith(
        {
          status: SessionInstanceStatus.Cancelled,
          cancelledAt: expect.any(Date),
        },
        expect.objectContaining({ where: { id: ['i-1', 'i-2'] } }),
      );
      expect(participantModel.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: SessionParticipantStatus.Cancelled }),
        expect.objectContaining({
          where: {
            instanceId: ['i-1', 'i-2'],
            status: [
              SessionParticipantStatus.Confirmed,
              SessionParticipantStatus.PendingApproval,
              SessionParticipantStatus.Waitlisted,
            ],
          },
        }),
      );
      // ACTIVE becomes CANCELLED; ENDED stays ENDED (no more top-ups either way).
      expect(active.update).toHaveBeenCalledWith(
        { status: SessionTemplateStatus.Cancelled, endedAt: expect.any(Date) },
        expect.anything(),
      );
      expect(ended.update).not.toHaveBeenCalled();
      expect(result).toEqual({
        templateIds: ['tmpl-a', 'tmpl-e'],
        cancelledInstances: 3,
        notifiedUserIds: ['usr-a', 'usr-b'],
      });
      const told = notifyService.notify.mock.calls.map(
        (
          c: [{ userId: string; message: { key: string; params: unknown } }],
        ) => [c[0].userId, c[0].message.key, c[0].message.params],
      );
      expect(told).toEqual([
        [
          'usr-a',
          'session.groupDeletedBookingsEnded',
          { group: 'Runners', count: 2 },
        ],
        [
          'usr-b',
          'session.groupDeletedBookingsEnded',
          { group: 'Runners', count: 2 },
        ],
      ]);
    });

    it('still stops a series with nothing scheduled, so no more are made', async () => {
      const active = seriesRow('tmpl-a', SessionTemplateStatus.Active);
      templateModel.findAll.mockResolvedValue([{ id: 'tmpl-a' }]);
      templateModel.findOne.mockResolvedValue(active);
      instanceModel.findAll.mockResolvedValue([]);

      await expect(
        service.cancelDeletedGroupSessions('group-1', 'Runners'),
      ).resolves.toMatchObject({
        templateIds: ['tmpl-a'],
        cancelledInstances: 0,
      });
      expect(active.update).toHaveBeenCalled();
      expect(instanceModel.update).not.toHaveBeenCalled();
      expect(notifyService.notify).not.toHaveBeenCalled();
    });

    it('keeps going when one series fails', async () => {
      templateModel.findAll.mockResolvedValue([
        { id: 'tmpl-x' },
        { id: 'tmpl-a' },
      ]);
      templateModel.findOne
        .mockRejectedValueOnce(new Error('lock timeout'))
        .mockResolvedValueOnce(
          seriesRow('tmpl-a', SessionTemplateStatus.Active),
        );
      instanceModel.findAll.mockResolvedValue([{ id: 'i-1' }]);
      participantModel.findAll.mockResolvedValue([{ userId: 'usr-a' }]);

      await expect(
        service.cancelDeletedGroupSessions('group-1', 'Runners'),
      ).resolves.toMatchObject({
        templateIds: ['tmpl-a'],
        cancelledInstances: 1,
      });
      expect(notifyService.notify).toHaveBeenCalledTimes(1);
    });
  });

  describe('promoteAfterSeriesCapacityRaise', () => {
    it('fills every future occurrence that follows the series and has people waiting', async () => {
      instanceModel.findAll.mockResolvedValue([
        { id: 'inst-1' },
        { id: 'inst-2' },
      ]);
      instanceModel.findOne.mockImplementation((q: { where: { id: string } }) =>
        Promise.resolve(
          makeInst({ id: q.where.id, template: { waitlistEnabled: true } }),
        ),
      );
      waitlistService.promoteIntoFreeSeats
        .mockResolvedValueOnce([{ participantId: 'p-1', userId: 'usr-a' }])
        .mockResolvedValueOnce([
          { participantId: 'p-2', userId: 'usr-b' },
          { participantId: 'p-3', userId: 'usr-c' },
        ]);

      await expect(
        service.promoteAfterSeriesCapacityRaise('tmpl-1'),
      ).resolves.toBe(3);

      const where = (
        instanceModel.findAll.mock.calls[0] as [
          { where: Record<string, unknown> },
        ]
      )[0].where;
      expect(where).toMatchObject({
        templateId: 'tmpl-1',
        status: SessionInstanceStatus.Scheduled,
        capacityOverride: null,
      });
      expect(where.waitlistedCount).toEqual({ [Op.gt]: 0 });
      expect(notifyService.notify).toHaveBeenCalledTimes(3);
    });

    it('keeps going when one occurrence fails, and tells nobody about it', async () => {
      instanceModel.findAll.mockResolvedValue([
        { id: 'inst-1' },
        { id: 'inst-2' },
      ]);
      instanceModel.findOne.mockImplementation((q: { where: { id: string } }) =>
        Promise.resolve(
          makeInst({ id: q.where.id, template: { waitlistEnabled: true } }),
        ),
      );
      waitlistService.promoteIntoFreeSeats
        .mockRejectedValueOnce(new Error('deadlock'))
        .mockResolvedValueOnce([{ participantId: 'p-2', userId: 'usr-b' }]);

      await expect(
        service.promoteAfterSeriesCapacityRaise('tmpl-1'),
      ).resolves.toBe(1);
      expect(notifyService.notify).toHaveBeenCalledTimes(1);
    });
  });

  describe('followUp', () => {
    const pastInstance = () =>
      makeInst({ startAt: new Date(Date.now() - 3_600_000) });
    const futureInstance = () =>
      makeInst({ startAt: new Date(Date.now() + 3_600_000) });

    it('G5a: rejects attendance audiences before session start (no attendance data yet)', async () => {
      instanceModel.findOne.mockResolvedValue(futureInstance());
      await expect(
        service.followUp('usr-instr', 'inst-1', {
          audience: 'attended',
          message: 'Thanks!',
        }),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.followUp('usr-instr', 'inst-1', {
          audience: 'noshow',
          message: 'Thanks!',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('G5b: audience=all on a future session is allowed (instructor announcement)', async () => {
      instanceModel.findOne.mockResolvedValue(futureInstance());
      participantModel.findAll.mockResolvedValue([{ userId: 'a' }]);
      const r = await service.followUp('usr-instr', 'inst-1', {
        audience: 'all',
        message: 'Running 10 min late.',
      });
      expect(r.notifiedUserIds).toEqual(['a']);
    });

    it('G5c: audience=userIds on a future session is allowed', async () => {
      instanceModel.findOne.mockResolvedValue(futureInstance());
      participantModel.findAll.mockResolvedValue([{ userId: 'a' }]);
      const r = await service.followUp('usr-instr', 'inst-1', {
        audience: 'userIds',
        userIds: ['a'],
        message: 'Quick heads-up.',
      });
      expect(r.notifiedUserIds).toEqual(['a']);
    });

    it('404 for cross-instructor caller', async () => {
      instanceModel.findOne.mockResolvedValue(pastInstance());
      await expect(
        service.followUp('usr-other', 'inst-1', {
          audience: 'all',
          message: 'X',
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('G6: audience=all queries non-terminal participants', async () => {
      instanceModel.findOne.mockResolvedValue(pastInstance());
      participantModel.findAll.mockResolvedValue([
        { userId: 'a' },
        { userId: 'b' },
      ]);
      const r = await service.followUp('usr-instr', 'inst-1', {
        audience: 'all',
        message: 'Thanks!',
      });
      const call = participantModel.findAll.mock.calls[0][0] as {
        where: { status: Record<symbol, string[]> };
      };
      // status excludes CANCELLED + DECLINED
      expect(call.where.status[Op.notIn]).toEqual([
        SessionParticipantStatus.Cancelled,
        SessionParticipantStatus.Declined,
      ]);
      expect(r.notifiedUserIds.sort()).toEqual(['a', 'b']);
    });

    it('G6b: audience=attended adds attended=true filter', async () => {
      instanceModel.findOne.mockResolvedValue(pastInstance());
      participantModel.findAll.mockResolvedValue([{ userId: 'a' }]);
      await service.followUp('usr-instr', 'inst-1', {
        audience: 'attended',
        message: 'See you next week!',
      });
      const call = participantModel.findAll.mock.calls[0][0] as {
        where: { attended: boolean };
      };
      expect(call.where.attended).toBe(true);
    });

    it('G6c: audience=noshow adds attended=false filter', async () => {
      instanceModel.findOne.mockResolvedValue(pastInstance());
      participantModel.findAll.mockResolvedValue([]);
      await service.followUp('usr-instr', 'inst-1', {
        audience: 'noshow',
        message: 'Missed you.',
      });
      const call = participantModel.findAll.mock.calls[0][0] as {
        where: { attended: boolean };
      };
      expect(call.where.attended).toBe(false);
    });

    it('G6d: audience=userIds intersects with current participants (no spray)', async () => {
      instanceModel.findOne.mockResolvedValue(pastInstance());
      participantModel.findAll.mockResolvedValue([{ userId: 'a' }]);
      await service.followUp('usr-instr', 'inst-1', {
        audience: 'userIds',
        userIds: ['a', 'b', 'c'],
        message: 'Targeted',
      });
      const call = participantModel.findAll.mock.calls[0][0] as {
        where: { userId: Record<symbol, string[]> };
      };
      expect(call.where.userId[Op.in]).toEqual(['a', 'b', 'c']);
    });

    it('G6e: audience=userIds with empty array → 400', async () => {
      instanceModel.findOne.mockResolvedValue(pastInstance());
      await expect(
        service.followUp('usr-instr', 'inst-1', {
          audience: 'userIds',
          userIds: [],
          message: 'X',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('G7: dedupes notifications by userId (no spam if duplicate rows somehow exist)', async () => {
      instanceModel.findOne.mockResolvedValue(pastInstance());
      participantModel.findAll.mockResolvedValue([
        { userId: 'a' },
        { userId: 'a' }, // dup, should not multiply notifications
        { userId: 'b' },
      ]);
      const r = await service.followUp('usr-instr', 'inst-1', {
        audience: 'all',
        message: 'Once',
      });
      expect(r.notifiedUserIds.sort()).toEqual(['a', 'b']);
      // exactly 2 notifications flushed
      expect(notifyService.notify).toHaveBeenCalledTimes(2);
    });

    it('strips HTML from message before notification', async () => {
      instanceModel.findOne.mockResolvedValue(pastInstance());
      participantModel.findAll.mockResolvedValue([{ userId: 'a' }]);
      await service.followUp('usr-instr', 'inst-1', {
        audience: 'all',
        message: "<script>alert('x')</script>Hello",
      });
      const payload = notificationText(notifyService.notify.mock.calls[0][0]);
      expect(payload.body).not.toContain('<script>');
      expect(payload.body).toContain('Hello');
    });

    it('G7b: rejects when message is empty after sanitization', async () => {
      instanceModel.findOne.mockResolvedValue(pastInstance());
      await expect(
        service.followUp('usr-instr', 'inst-1', {
          audience: 'all',
          message: '<script>x</script>',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});
