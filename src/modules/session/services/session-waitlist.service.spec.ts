import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import type { Transaction } from 'sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { SessionWaitlistService } from './session-waitlist.service';
import { SessionInstance } from '../entities/session-instance.entity';
import { SessionParticipant } from '../entities/session-participant.entity';
import { SessionReminderSchedule } from '../entities/session-reminder-schedule.entity';
import {
  SessionParticipantStatus,
  SessionReminderKind,
} from '../entities/session.enums';
import { makeSilentLogger } from '../../../../test/helpers/sequelize-mocks';

const fakeTx = { LOCK: { UPDATE: 'UPDATE' } } as never;

const fakeInstance = (
  startAt: Date,
  template?: Partial<{ capacity: number | null }>,
) =>
  ({
    id: 'inst-1',
    startAt,
    template: { capacity: template?.capacity ?? null },
  }) as unknown as SessionInstance;

describe('SessionWaitlistService', () => {
  let service: SessionWaitlistService;
  let instanceModel: { increment: jest.Mock; findOne: jest.Mock };
  let participantModel: { findOne: jest.Mock };
  let reminderModel: { findOrCreate: jest.Mock; destroy: jest.Mock };

  beforeEach(async () => {
    instanceModel = {
      increment: jest.fn().mockResolvedValue(undefined),
      findOne: jest
        .fn()
        // Default: plenty of headroom — won't trigger the cap guard.
        .mockResolvedValue({ confirmedCount: 0, capacityOverride: null }),
    };
    participantModel = { findOne: jest.fn() };
    reminderModel = {
      findOrCreate: jest.fn().mockResolvedValue([{}, true]),
      destroy: jest.fn().mockResolvedValue(0),
    };
    const module = await Test.createTestingModule({
      providers: [
        SessionWaitlistService,
        { provide: getModelToken(SessionInstance), useValue: instanceModel },
        {
          provide: getModelToken(SessionParticipant),
          useValue: participantModel,
        },
        {
          provide: getModelToken(SessionReminderSchedule),
          useValue: reminderModel,
        },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();
    service = module.get(SessionWaitlistService);
  });

  describe('tryPromote', () => {
    it('returns null when session is within 2h of start', async () => {
      const result = await service.tryPromote(
        fakeInstance(new Date(Date.now() + 60 * 60_000)), // 1h ahead
        fakeTx,
      );
      expect(result).toBeNull();
      expect(participantModel.findOne).not.toHaveBeenCalled();
    });

    it('returns null when no waitlister exists', async () => {
      participantModel.findOne.mockResolvedValue(null);
      const result = await service.tryPromote(
        fakeInstance(new Date(Date.now() + 24 * 3_600_000)),
        fakeTx,
      );
      expect(result).toBeNull();
    });

    it('promotes oldest waitlister + adjusts counters', async () => {
      const p = {
        id: 'p-wl',
        userId: 'usr-wl',
        update: jest.fn().mockResolvedValue(undefined),
      };
      participantModel.findOne.mockResolvedValue(p);
      const result = await service.tryPromote(
        fakeInstance(new Date(Date.now() + 24 * 3_600_000)),
        fakeTx,
      );
      expect(result).toEqual({ participantId: 'p-wl', userId: 'usr-wl' });
      expect(p.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: SessionParticipantStatus.Confirmed,
          waitlistPosition: null,
        }),
        expect.anything(),
      );
      expect(instanceModel.increment).toHaveBeenCalledWith(
        { waitlistedCount: -1, confirmedCount: 1 },
        expect.anything(),
      );
    });

    it('queries the oldest waitlister via ORDER BY bookedAt ASC', async () => {
      participantModel.findOne.mockResolvedValue(null);
      await service.tryPromote(
        fakeInstance(new Date(Date.now() + 24 * 3_600_000)),
        fakeTx,
      );
      const args = participantModel.findOne.mock.calls[0][0] as {
        where: { status: string };
        order: Array<Array<string>>;
      };
      expect(args.where.status).toBe(SessionParticipantStatus.Waitlisted);
      expect(args.order).toEqual([['bookedAt', 'ASC']]);
    });

    it('AUDIT FIX (B4): refuses to promote when fresh confirmedCount >= cap', async () => {
      instanceModel.findOne.mockResolvedValue({
        confirmedCount: 10,
        capacityOverride: null,
      });
      const result = await service.tryPromote(
        fakeInstance(new Date(Date.now() + 24 * 3_600_000), { capacity: 10 }),
        fakeTx,
      );
      expect(result).toBeNull();
      expect(participantModel.findOne).not.toHaveBeenCalled();
    });

    it('AUDIT FIX (B4): refresh respects capacityOverride over template.capacity', async () => {
      instanceModel.findOne.mockResolvedValue({
        confirmedCount: 5,
        capacityOverride: 5, // override hit
      });
      const result = await service.tryPromote(
        fakeInstance(new Date(Date.now() + 24 * 3_600_000), { capacity: 50 }),
        fakeTx,
      );
      expect(result).toBeNull();
    });

    it('returns null when fresh row not found (instance vanished mid-tx)', async () => {
      instanceModel.findOne.mockResolvedValue(null);
      const result = await service.tryPromote(
        fakeInstance(new Date(Date.now() + 24 * 3_600_000)),
        fakeTx,
      );
      expect(result).toBeNull();
    });
  });

  describe('promoteIntoFreeSeats', () => {
    const instance = {} as SessionInstance;
    const tx = {} as Transaction;

    it('promotes one by one until nobody waits or the seats are full', async () => {
      const tryPromote = jest
        .spyOn(service, 'tryPromote')
        .mockResolvedValueOnce({ participantId: 'p-1', userId: 'u-1' })
        .mockResolvedValueOnce({ participantId: 'p-2', userId: 'u-2' })
        .mockResolvedValueOnce(null);

      await expect(service.promoteIntoFreeSeats(instance, tx)).resolves.toEqual(
        [
          { participantId: 'p-1', userId: 'u-1' },
          { participantId: 'p-2', userId: 'u-2' },
        ],
      );
      expect(tryPromote).toHaveBeenCalledTimes(3);
      expect(tryPromote).toHaveBeenCalledWith(instance, tx);
    });

    it('promotes nobody when the first try finds no seat or no one', async () => {
      jest.spyOn(service, 'tryPromote').mockResolvedValue(null);
      await expect(service.promoteIntoFreeSeats(instance, tx)).resolves.toEqual(
        [],
      );
    });

    it('stops at the capacity ceiling even if every try succeeds', async () => {
      const tryPromote = jest
        .spyOn(service, 'tryPromote')
        .mockResolvedValue({ participantId: 'p', userId: 'u' });
      const promoted = await service.promoteIntoFreeSeats(instance, tx);
      expect(promoted).toHaveLength(1000);
      expect(tryPromote).toHaveBeenCalledTimes(1000);
    });
  });

  describe('scheduleReminders', () => {
    it('schedules both 24h and 1h reminders when session is > 24h away', async () => {
      const inst = fakeInstance(new Date(Date.now() + 48 * 3_600_000));
      await service.scheduleReminders('p-1', inst, fakeTx);
      expect(reminderModel.findOrCreate).toHaveBeenCalledTimes(2);
      const kinds = reminderModel.findOrCreate.mock.calls
        .map((c) => (c[0] as { where: { kind: string } }).where.kind)
        .sort();
      expect(kinds).toEqual([
        SessionReminderKind.Reminder1h,
        SessionReminderKind.Reminder24h,
      ]);
    });

    it('skips 24h reminder when session is within 24h', async () => {
      const inst = fakeInstance(new Date(Date.now() + 6 * 3_600_000));
      await service.scheduleReminders('p-1', inst, fakeTx);
      expect(reminderModel.findOrCreate).toHaveBeenCalledTimes(1);
      const args = reminderModel.findOrCreate.mock.calls[0][0] as {
        where: { kind: string };
      };
      expect(args.where.kind).toBe(SessionReminderKind.Reminder1h);
    });

    it('skips both reminders when session is within 1h', async () => {
      const inst = fakeInstance(new Date(Date.now() + 30 * 60_000));
      await service.scheduleReminders('p-1', inst, fakeTx);
      expect(reminderModel.findOrCreate).not.toHaveBeenCalled();
    });

    it('swallows UniqueConstraintError (idempotent re-schedule)', async () => {
      const err = Object.assign(new Error('dup'), {
        name: 'SequelizeUniqueConstraintError',
      });
      reminderModel.findOrCreate.mockRejectedValue(err);
      const inst = fakeInstance(new Date(Date.now() + 48 * 3_600_000));
      await expect(
        service.scheduleReminders('p-1', inst, fakeTx),
      ).resolves.toBeUndefined();
    });

    it('rethrows non-unique errors', async () => {
      reminderModel.findOrCreate.mockRejectedValue(new Error('boom'));
      const inst = fakeInstance(new Date(Date.now() + 48 * 3_600_000));
      await expect(
        service.scheduleReminders('p-1', inst, fakeTx),
      ).rejects.toThrow('boom');
    });
  });

  describe('deleteRemindersFor', () => {
    it('only deletes unsent rows', async () => {
      await service.deleteRemindersFor('p-1', fakeTx);
      expect(reminderModel.destroy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { participantId: 'p-1', sentAt: null },
        }),
      );
    });
  });
});
