import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op } from 'sequelize';
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

const fakeSequelize = () =>
  ({
    transaction: async <T>(
      cb: (tx: { LOCK: { UPDATE: 'UPDATE' } }) => Promise<T>,
    ) => cb({ LOCK: { UPDATE: 'UPDATE' } }),
  }) as unknown as Sequelize;

const future = (ms = 7 * 86_400_000) => new Date(Date.now() + ms);

const makeInstance = (
  id: string,
  o: Partial<{ status: SessionInstanceStatus; waitlistEnabled: boolean }> = {},
) => ({
  id,
  templateId: 'tmpl-1',
  instructorId: 'usr-coach',
  status: o.status ?? SessionInstanceStatus.Scheduled,
  startAt: future(),
  titleOverride: null,
  template: {
    id: 'tmpl-1',
    title: 'Morning run',
    status: SessionTemplateStatus.Active,
    access: SessionAccess.GroupOnly,
    groupId: 'group-1',
    waitlistEnabled: o.waitlistEnabled ?? true,
    capacity: 10,
    timezone: 'Europe/Bucharest',
  } as unknown as SessionTemplate,
});

const makeBooking = (
  id: string,
  instanceId: string,
  status: SessionParticipantStatus,
) => {
  const row: Record<string, unknown> = {
    id,
    instanceId,
    userId: 'usr-member',
    status,
    update: jest.fn(function (
      this: Record<string, unknown>,
      u: Record<string, unknown>,
    ) {
      Object.assign(this, u);
      return Promise.resolve(this);
    }),
  };
  return row;
};

describe('SessionBookingService.endGroupOnlyBookings', () => {
  let service: SessionBookingService;
  let instanceModel: { findOne: jest.Mock; increment: jest.Mock };
  let participantModel: { findAll: jest.Mock; findOne: jest.Mock };
  let waitlistService: { tryPromote: jest.Mock; deleteRemindersFor: jest.Mock };
  let notifyService: { notify: jest.Mock };
  let bookings: Record<string, Record<string, unknown>>;

  beforeEach(async () => {
    bookings = {};
    instanceModel = {
      findOne: jest.fn((q: { where: { id: string } }) =>
        Promise.resolve(makeInstance(q.where.id)),
      ),
      increment: jest.fn().mockResolvedValue(undefined),
    };
    participantModel = {
      findAll: jest.fn(),
      findOne: jest.fn((q: { where: { id: string } }) =>
        Promise.resolve(bookings[q.where.id] ?? null),
      ),
    };
    waitlistService = {
      tryPromote: jest.fn().mockResolvedValue(null),
      deleteRemindersFor: jest.fn().mockResolvedValue(undefined),
    };
    notifyService = { notify: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        SessionBookingService,
        { provide: getModelToken(SessionInstance), useValue: instanceModel },
        {
          provide: getModelToken(SessionParticipant),
          useValue: participantModel,
        },
        { provide: getModelToken(SessionTemplate), useValue: {} },
        { provide: getModelToken(User), useValue: {} },
        { provide: SessionAccessService, useValue: {} },
        { provide: SessionWaitlistService, useValue: waitlistService },
        { provide: NotificationService, useValue: notifyService },
        { provide: Sequelize, useValue: fakeSequelize() },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();
    service = moduleRef.get(SessionBookingService);
  });

  function open(...rows: Record<string, unknown>[]) {
    for (const row of rows) {
      bookings[row.id as string] = row;
    }
    participantModel.findAll.mockResolvedValue(
      rows.map((row) => ({ id: row.id, instanceId: row.instanceId })),
    );
  }

  it('looks only at open bookings in the group’s members-only sessions still ahead', async () => {
    open();
    await service.endGroupOnlyBookings('group-1', 'Runners', 'usr-member');

    const query = (
      participantModel.findAll.mock.calls[0] as [
        {
          where: { userId: string; status: string[] };
          include: {
            where: { status: string; startAt: Record<symbol, Date> };
            include: { where: Record<string, string> }[];
          }[];
        },
      ]
    )[0];
    expect(query.where.userId).toBe('usr-member');
    expect([...query.where.status].sort()).toEqual(
      [
        SessionParticipantStatus.Confirmed,
        SessionParticipantStatus.PendingApproval,
        SessionParticipantStatus.Waitlisted,
      ].sort(),
    );
    const instance = query.include[0];
    expect(instance.where.status).toBe(SessionInstanceStatus.Scheduled);
    expect(instance.where.startAt[Op.gt]).toBeInstanceOf(Date);
    expect(instance.include[0].where).toEqual({
      groupId: 'group-1',
      access: SessionAccess.GroupOnly,
    });
  });

  it('cancels each booking, moves the counters, drops the reminders and tells the person once', async () => {
    const confirmed = makeBooking(
      'p-1',
      'inst-1',
      SessionParticipantStatus.Confirmed,
    );
    const waiting = makeBooking(
      'p-2',
      'inst-2',
      SessionParticipantStatus.Waitlisted,
    );
    open(confirmed, waiting);

    await expect(
      service.endGroupOnlyBookings('group-1', 'Runners', 'usr-member'),
    ).resolves.toBe(2);

    expect(confirmed.status).toBe(SessionParticipantStatus.Cancelled);
    expect(waiting.status).toBe(SessionParticipantStatus.Cancelled);
    expect(instanceModel.increment).toHaveBeenCalledTimes(2);
    expect(waitlistService.deleteRemindersFor).toHaveBeenCalledWith(
      'p-1',
      expect.anything(),
    );
    expect(notifyService.notify).toHaveBeenCalledTimes(1);
    expect(notifyService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'usr-member',
        message: {
          key: 'session.groupBookingsEnded',
          params: { group: 'Runners', count: 2 },
        },
      }),
    );
  });

  it('gives a freed confirmed seat to the oldest waitlister, and tells them', async () => {
    open(makeBooking('p-1', 'inst-1', SessionParticipantStatus.Confirmed));
    waitlistService.tryPromote.mockResolvedValue({
      participantId: 'p-9',
      userId: 'usr-next',
    });

    await service.endGroupOnlyBookings('group-1', 'Runners', 'usr-member');

    expect(waitlistService.tryPromote).toHaveBeenCalledTimes(1);
    const told = notifyService.notify.mock.calls.map(
      (c: [{ userId: string; message: { key: string } }]) => [
        c[0].userId,
        c[0].message.key,
      ],
    );
    expect(told).toEqual([
      ['usr-next', 'session.bookingPromoted'],
      ['usr-member', 'session.groupBookingsEnded'],
    ]);
  });

  it('promotes nobody when a waiting or pending booking ends', async () => {
    open(makeBooking('p-1', 'inst-1', SessionParticipantStatus.Waitlisted));
    await service.endGroupOnlyBookings('group-1', 'Runners', 'usr-member');
    expect(waitlistService.tryPromote).not.toHaveBeenCalled();
  });

  it('skips a booking that ended meanwhile, and says nothing when none ended', async () => {
    open(makeBooking('p-1', 'inst-1', SessionParticipantStatus.Cancelled));
    await expect(
      service.endGroupOnlyBookings('group-1', 'Runners', 'usr-member'),
    ).resolves.toBe(0);
    expect(instanceModel.increment).not.toHaveBeenCalled();
    expect(notifyService.notify).not.toHaveBeenCalled();
  });

  it('keeps going when one occurrence fails, and counts only what ended', async () => {
    open(
      makeBooking('p-1', 'inst-1', SessionParticipantStatus.Confirmed),
      makeBooking('p-2', 'inst-2', SessionParticipantStatus.Confirmed),
    );
    instanceModel.findOne.mockImplementationOnce(() =>
      Promise.reject(new Error('lock timeout')),
    );

    await expect(
      service.endGroupOnlyBookings('group-1', 'Runners', 'usr-member'),
    ).resolves.toBe(1);
    expect(notifyService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          params: { group: 'Runners', count: 1 },
        }) as unknown,
      }),
    );
  });
});
