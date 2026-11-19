import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op } from 'sequelize';
import { SessionClientService } from './session-client.service';
import { SessionInstance } from '../entities/session-instance.entity';
import { SessionParticipant } from '../entities/session-participant.entity';
import {
  SessionInstanceStatus,
  SessionParticipantStatus,
} from '../entities/session.enums';
import { makeSilentLogger } from '../../../../test/helpers/sequelize-mocks';

describe('SessionClientService', () => {
  let service: SessionClientService;
  let participantModel: {
    findAndCountAll: jest.Mock;
    findOne: jest.Mock;
    count: jest.Mock;
  };
  let instanceModel: { findOne: jest.Mock };

  beforeEach(async () => {
    participantModel = {
      findAndCountAll: jest.fn().mockResolvedValue({ rows: [], count: 0 }),
      findOne: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
    };
    instanceModel = { findOne: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        SessionClientService,
        {
          provide: getModelToken(SessionParticipant),
          useValue: participantModel,
        },
        { provide: getModelToken(SessionInstance), useValue: instanceModel },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();
    service = module.get(SessionClientService);
  });

  // ─── LIST MY ──────────────────────────────────────────────────────

  describe('listMy', () => {
    it('F1: upcoming tab filters CONFIRMED + future instances, ASC order', async () => {
      await service.listMy('usr-1', { tab: 'upcoming', page: 1, limit: 20 });
      const call = participantModel.findAndCountAll.mock.calls[0][0] as {
        where: { status: string };
        include: Array<{ where?: Record<string | symbol, unknown> }>;
        order: Array<unknown[]>;
      };
      expect(call.where.status).toBe(SessionParticipantStatus.Confirmed);
      // Instance filter requires startAt >= now
      const instWhere = call.include[0].where as {
        startAt: Record<symbol, Date>;
      };
      expect(instWhere.startAt[Op.gte]).toBeInstanceOf(Date);
      // Order is ASC for active tabs
      expect(call.order[0][2]).toBe('ASC');
    });

    it('F2: past tab filters CONFIRMED + past instances, DESC order', async () => {
      await service.listMy('usr-1', { tab: 'past', page: 1, limit: 20 });
      const call = participantModel.findAndCountAll.mock.calls[0][0] as {
        where: { status: string };
        include: Array<{ where?: Record<string | symbol, unknown> }>;
        order: Array<unknown[]>;
      };
      expect(call.where.status).toBe(SessionParticipantStatus.Confirmed);
      const instWhere = call.include[0].where as {
        startAt: Record<symbol, Date>;
      };
      expect(instWhere.startAt[Op.lt]).toBeInstanceOf(Date);
      expect(call.order[0][2]).toBe('DESC');
    });

    it('cancelled tab includes BOTH CANCELLED and DECLINED', async () => {
      await service.listMy('usr-1', { tab: 'cancelled', page: 1, limit: 20 });
      const call = participantModel.findAndCountAll.mock.calls[0][0] as {
        where: { status: Record<symbol, string[]> };
      };
      expect(call.where.status[Op.in]).toEqual([
        SessionParticipantStatus.Cancelled,
        SessionParticipantStatus.Declined,
      ]);
    });

    it('default tab is "upcoming" when none provided', async () => {
      await service.listMy('usr-1', { page: 1, limit: 20 });
      const call = participantModel.findAndCountAll.mock.calls[0][0] as {
        where: { status: string };
      };
      expect(call.where.status).toBe(SessionParticipantStatus.Confirmed);
    });

    it('PRIVACY: attributes allowlist excludes privateNote, snapshotMeetingUrl, snapshotLocationText', async () => {
      await service.listMy('usr-1', { page: 1, limit: 20 });
      const attrs = (
        participantModel.findAndCountAll.mock.calls[0][0] as {
          attributes: string[];
        }
      ).attributes;
      expect(attrs).not.toContain('privateNote');
      expect(attrs).not.toContain('snapshotMeetingUrl');
      expect(attrs).not.toContain('snapshotLocationText');
      // confirm we DO include bookingNote (it's their own)
      expect(attrs).toContain('bookingNote');
    });
  });

  // ─── COUNTS ───────────────────────────────────────────────────────

  describe('counts', () => {
    it('F3 + F4: runs exactly FIVE count queries in parallel (no list fetched)', async () => {
      participantModel.count
        .mockResolvedValueOnce(2) // upcoming
        .mockResolvedValueOnce(1) // pendingApproval
        .mockResolvedValueOnce(3) // waitlisted
        .mockResolvedValueOnce(7) // past
        .mockResolvedValueOnce(0); // cancelled

      const result = await service.counts('usr-1');

      expect(participantModel.count).toHaveBeenCalledTimes(5);
      // CRITICAL: no list fetch happened.
      expect(participantModel.findAndCountAll).not.toHaveBeenCalled();
      expect(result).toEqual({
        upcoming: 2,
        pendingApproval: 1,
        waitlisted: 3,
        past: 7,
        cancelled: 0,
      });
    });

    it('counts uses indexed scope: WHERE userId + status (+ instance filter)', async () => {
      await service.counts('usr-1');
      const upcomingCall = participantModel.count.mock.calls[0][0] as {
        where: { userId: string; status: string };
      };
      expect(upcomingCall.where.userId).toBe('usr-1');
      expect(upcomingCall.where.status).toBe(
        SessionParticipantStatus.Confirmed,
      );
    });
  });

  // ─── ICS ──────────────────────────────────────────────────────────

  describe('ics', () => {
    const fakeInst = () =>
      ({
        id: 'inst-1',
        templateId: 'tmpl-1',
        startAt: new Date('2026-06-15T10:00:00Z'),
        endAt: new Date('2026-06-15T11:00:00Z'),
        updatedAt: new Date('2026-05-15T12:00:00Z'),
        status: SessionInstanceStatus.Scheduled,
        titleOverride: null,
        descriptionOverride: null,
        template: {
          title: 'Yoga; flow, & breath',
          description: 'Bring a mat\nand water',
          locationKind: 'IN_PERSON',
          meetingProvider: null,
          access: 'OPEN',
        },
        instructor: {
          firstName: 'Ana',
          lastName: 'Pop',
          email: 'ana@motionhive.fit',
        },
        venueOverride: null,
      }) as unknown as SessionInstance;

    it('F5: DTSTART matches instance.startAt in YYYYMMDDTHHmmssZ', async () => {
      instanceModel.findOne.mockResolvedValue(fakeInst());
      const ics = await service.ics('usr-1', 'inst-1');
      expect(ics).toContain('DTSTART:20260615T100000Z');
      expect(ics).toContain('DTEND:20260615T110000Z');
    });

    it('F6: CANCELLED instance has STATUS:CANCELLED', async () => {
      const inst = fakeInst();
      (inst as { status: string }).status = SessionInstanceStatus.Cancelled;
      instanceModel.findOne.mockResolvedValue(inst);
      const ics = await service.ics('usr-1', 'inst-1');
      expect(ics).toContain('STATUS:CANCELLED');
    });

    it('escapes special characters in SUMMARY and DESCRIPTION', async () => {
      instanceModel.findOne.mockResolvedValue(fakeInst());
      const ics = await service.ics('usr-1', 'inst-1');
      // semicolon, comma, ampersand stay (last not special) but `;` and
      // `,` get backslash-escaped
      expect(ics).toContain('SUMMARY:Yoga\\; flow\\, & breath');
      // newline in description becomes \n
      expect(ics).toContain('DESCRIPTION:Bring a mat\\nand water');
    });

    it('returns 404 for missing instance', async () => {
      instanceModel.findOne.mockResolvedValue(null);
      await expect(service.ics('usr-1', 'inst-x')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('AUDIT FIX (F-Bug 1): refuses .ics for gated session non-participant (404)', async () => {
      const inst = fakeInst();
      (inst.template as { access: string }).access = 'CLIENTS_ONLY';
      instanceModel.findOne.mockResolvedValue(inst);
      participantModel.findOne.mockResolvedValue(null); // not a participant
      await expect(service.ics('usr-1', 'inst-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('AUDIT FIX (F-Bug 1): allows .ics for gated session active participant', async () => {
      const inst = fakeInst();
      (inst.template as { access: string }).access = 'CLIENTS_ONLY';
      instanceModel.findOne.mockResolvedValue(inst);
      participantModel.findOne.mockResolvedValue({
        status: SessionParticipantStatus.Confirmed,
        snapshotMeetingUrl: null,
      });
      const ics = await service.ics('usr-1', 'inst-1');
      expect(ics).toContain('BEGIN:VCALENDAR');
    });

    it('AUDIT FIX (F-Bug 3): ONLINE confirmed participant gets URL property', async () => {
      const inst = fakeInst();
      (inst.template as { locationKind: string }).locationKind = 'ONLINE';
      (inst.template as { meetingUrl: string }).meetingUrl =
        'https://zoom.us/j/123';
      instanceModel.findOne.mockResolvedValue(inst);
      participantModel.findOne.mockResolvedValue({
        status: SessionParticipantStatus.Confirmed,
        snapshotMeetingUrl: 'https://zoom.us/j/snapshot',
      });
      const ics = await service.ics('usr-1', 'inst-1');
      // The link as it is now: a changed link reaches people already booked.
      expect(ics).toContain('URL:https://zoom.us/j/123');
    });

    it('falls back to the link saved at booking when the session has none now', async () => {
      const inst = fakeInst();
      (inst.template as { locationKind: string }).locationKind = 'ONLINE';
      (inst.template as { meetingUrl: string | null }).meetingUrl = null;
      instanceModel.findOne.mockResolvedValue(inst);
      participantModel.findOne.mockResolvedValue({
        status: SessionParticipantStatus.Confirmed,
        snapshotMeetingUrl: 'https://zoom.us/j/snapshot',
      });
      const ics = await service.ics('usr-1', 'inst-1');
      expect(ics).toContain('URL:https://zoom.us/j/snapshot');
    });

    it('AUDIT FIX (F-Bug 3): ONLINE non-participant of OPEN session does NOT get URL', async () => {
      const inst = fakeInst();
      (inst.template as { locationKind: string }).locationKind = 'ONLINE';
      (inst.template as { meetingUrl: string }).meetingUrl =
        'https://zoom.us/j/secret';
      // access stays OPEN; non-participant authed caller
      instanceModel.findOne.mockResolvedValue(inst);
      participantModel.findOne.mockResolvedValue(null);
      const ics = await service.ics('usr-1', 'inst-1');
      expect(ics).toContain('BEGIN:VCALENDAR'); // allowed because OPEN
      expect(ics).not.toContain('zoom.us/j/secret');
    });
  });

  // ─── JOIN INFO ────────────────────────────────────────────────────

  describe('joinInfo', () => {
    it('F7: 403 for non-confirmed participant (or wrong user, or no booking)', async () => {
      participantModel.findOne.mockResolvedValue(null);
      await expect(service.joinInfo('usr-1', 'inst-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('F8: joinActiveFrom = startAt − 5min, joinActiveUntil = startAt + 15min', async () => {
      const startAt = new Date('2026-06-15T10:00:00Z');
      participantModel.findOne.mockResolvedValue({
        id: 'p-1',
        snapshotMeetingUrl: 'https://meet.google.com/abc',
      });
      instanceModel.findOne.mockResolvedValue({
        id: 'inst-1',
        startAt,
        meetingUrlOverride: null,
        template: { meetingUrl: null, locationKind: 'ONLINE' },
      });
      const info = await service.joinInfo('usr-1', 'inst-1');
      expect(info.joinActiveFrom).toEqual(
        new Date(startAt.getTime() - 5 * 60_000),
      );
      expect(info.joinActiveUntil).toEqual(
        new Date(startAt.getTime() + 15 * 60_000),
      );
      // Snapshot wins over live template values (terms-as-booked)
      expect(info.meetingUrl).toBe('https://meet.google.com/abc');
    });

    it('PRIVACY: snapshot meeting URL preferred, falls back to template only if snapshot is null', async () => {
      participantModel.findOne.mockResolvedValue({
        id: 'p-1',
        snapshotMeetingUrl: null,
      });
      instanceModel.findOne.mockResolvedValue({
        id: 'inst-1',
        startAt: new Date(),
        meetingUrlOverride: 'https://override.example.com',
        template: { meetingUrl: 'https://template.example.com' },
      });
      const info = await service.joinInfo('usr-1', 'inst-1');
      expect(info.meetingUrl).toBe('https://override.example.com');
    });

    it('gives the link as it is now, once the coach changed it, and while the session runs', async () => {
      participantModel.findOne.mockResolvedValue({
        id: 'p-1',
        snapshotMeetingUrl: 'https://meet.google.com/old-room',
      });
      instanceModel.findOne.mockResolvedValue({
        id: 'inst-1',
        startAt: new Date(),
        meetingUrlOverride: null,
        template: { meetingUrl: 'https://meet.google.com/new-room' },
      });

      const info = await service.joinInfo('usr-1', 'inst-1');

      expect(info.meetingUrl).toBe('https://meet.google.com/new-room');
      // A session the hourly job marked IN_PROGRESS at its start still
      // gives its link until start + 15 minutes.
      const where = instanceModel.findOne.mock.calls[0][0].where as {
        status: Record<symbol, string[]>;
      };
      expect(where.status[Op.in]).toEqual(['SCHEDULED', 'IN_PROGRESS']);
    });

    it('F9: 404 when session has no meeting URL anywhere (IN_PERSON session)', async () => {
      participantModel.findOne.mockResolvedValue({
        id: 'p-1',
        snapshotMeetingUrl: null,
      });
      instanceModel.findOne.mockResolvedValue({
        id: 'inst-1',
        startAt: new Date(),
        meetingUrlOverride: null,
        template: { meetingUrl: null },
      });
      await expect(service.joinInfo('usr-1', 'inst-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('F9b: 404 when instance is not SCHEDULED (covers query filter)', async () => {
      participantModel.findOne.mockResolvedValue({
        id: 'p-1',
        snapshotMeetingUrl: 'https://x',
      });
      instanceModel.findOne.mockResolvedValue(null);
      await expect(service.joinInfo('usr-1', 'inst-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
