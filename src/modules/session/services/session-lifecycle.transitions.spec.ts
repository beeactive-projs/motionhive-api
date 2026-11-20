import { SessionWaitlistService } from './session-waitlist.service';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { SessionLifecycleService } from './session-lifecycle.service';
import { SessionConflictService } from './session-conflict.service';
import { SessionInstance } from '../entities/session-instance.entity';
import { SessionParticipant } from '../entities/session-participant.entity';
import { SessionTemplate } from '../entities/session-template.entity';
import { VenueService } from '../../venue/venue.service';
import { NotificationService } from '../../notification/notification.service';
import { SessionInstanceStatus } from '../entities/session.enums';
import { makeSilentLogger } from '../../../../test/helpers/sequelize-mocks';

const fakeSequelize = () =>
  ({
    transaction: async <T>(cb: (tx: unknown) => Promise<T>) =>
      cb({ LOCK: { UPDATE: 'UPDATE' } }),
  }) as unknown as Sequelize;

describe('SessionLifecycleService.runStatusTransitions', () => {
  let service: SessionLifecycleService;
  let instanceModel: { update: jest.Mock };

  beforeEach(async () => {
    instanceModel = { update: jest.fn() };

    const ref = await Test.createTestingModule({
      providers: [
        SessionLifecycleService,
        { provide: getModelToken(SessionInstance), useValue: instanceModel },
        { provide: getModelToken(SessionParticipant), useValue: {} },
        { provide: getModelToken(SessionTemplate), useValue: {} },
        { provide: SessionConflictService, useValue: {} },
        { provide: VenueService, useValue: {} },
        { provide: SessionWaitlistService, useValue: {} },
        { provide: NotificationService, useValue: {} },
        { provide: Sequelize, useValue: fakeSequelize() },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = ref.get(SessionLifecycleService);
  });

  it('flips SCHEDULED→IN_PROGRESS (start passed) then IN_PROGRESS→COMPLETED (end passed)', async () => {
    instanceModel.update
      .mockResolvedValueOnce([3]) // started
      .mockResolvedValueOnce([2]); // completed
    const now = new Date('2026-06-30T10:00:00Z');

    const result = await service.runStatusTransitions(now);

    expect(result).toEqual({ started: 3, completed: 2 });

    // Start-transition runs first.
    expect(instanceModel.update.mock.calls[0][0]).toEqual({
      status: SessionInstanceStatus.InProgress,
    });
    expect(instanceModel.update.mock.calls[0][1].where).toEqual({
      status: SessionInstanceStatus.Scheduled,
      startAt: { [Op.lte]: now },
    });

    // Complete-transition runs second.
    expect(instanceModel.update.mock.calls[1][0]).toEqual({
      status: SessionInstanceStatus.Completed,
    });
    expect(instanceModel.update.mock.calls[1][1].where).toEqual({
      status: SessionInstanceStatus.InProgress,
      endAt: { [Op.lte]: now },
    });
  });

  it('returns zero counts when nothing is due', async () => {
    instanceModel.update.mockResolvedValue([0]);
    const result = await service.runStatusTransitions(new Date());
    expect(result).toEqual({ started: 0, completed: 0 });
  });
});
