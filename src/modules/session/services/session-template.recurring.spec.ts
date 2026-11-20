import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { SessionTemplateService } from './session-template.service';
import { RecurrenceService } from './recurrence.service';
import { SessionTemplate } from '../entities/session-template.entity';
import { SessionInstance } from '../entities/session-instance.entity';
import { VenueService } from '../../venue/venue.service';
import { GroupService } from '../../group/group.service';
import { SearchIndexService } from '../../search/search-index.service';
import { SessionLifecycleService } from './session-lifecycle.service';
import { SessionTemplateStatus } from '../entities/session.enums';
import { makeSilentLogger } from '../../../../test/helpers/sequelize-mocks';

const makeTemplate = () => ({
  id: 't1',
  instructorId: 'i1',
  isRecurring: true,
  status: SessionTemplateStatus.Active,
  recurrenceRule: { frequency: 'WEEKLY', interval: 1, daysOfWeek: [1] },
  timezone: 'Europe/Bucharest',
  firstStartAt: new Date('2026-07-06T08:00:00Z'),
  durationMinutes: 60,
});

const eightDates = () =>
  Array.from({ length: 8 }, (_, i) => new Date(2026, 6, 6 + i * 7, 8, 0, 0));

describe('SessionTemplateService.generateDueRecurringForAll', () => {
  let service: SessionTemplateService;
  let templateModel: {
    findAll: jest.Mock;
    sequelize: { transaction: jest.Mock };
  };
  let instanceModel: {
    count: jest.Mock;
    findOne: jest.Mock;
    create: jest.Mock;
  };
  let recurrence: { computeOccurrences: jest.Mock };

  beforeEach(async () => {
    templateModel = {
      findAll: jest.fn().mockResolvedValue([]),
      sequelize: {
        transaction: jest.fn().mockResolvedValue({
          commit: jest.fn().mockResolvedValue(undefined),
          rollback: jest.fn().mockResolvedValue(undefined),
        }),
      },
    };
    instanceModel = {
      count: jest.fn().mockResolvedValue(0),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'new-inst' }),
    };
    recurrence = {
      computeOccurrences: jest
        .fn()
        .mockReturnValue({ dates: eightDates(), truncated: false }),
    };

    const ref = await Test.createTestingModule({
      providers: [
        SessionTemplateService,
        { provide: getModelToken(SessionTemplate), useValue: templateModel },
        { provide: getModelToken(SessionInstance), useValue: instanceModel },
        { provide: RecurrenceService, useValue: recurrence },
        { provide: VenueService, useValue: {} },
        { provide: GroupService, useValue: {} },
        { provide: SearchIndexService, useValue: {} },
        { provide: SessionLifecycleService, useValue: {} },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = ref.get(SessionTemplateService);
  });

  it('tops up an active recurring template that is below the horizon', async () => {
    templateModel.findAll.mockResolvedValue([makeTemplate()]);
    instanceModel.count.mockResolvedValue(0); // no future occurrences yet

    const result = await service.generateDueRecurringForAll(new Date());

    expect(result.templatesScanned).toBe(1);
    expect(result.templatesToppedUp).toBe(1);
    expect(result.created).toBe(8);
    expect(instanceModel.create).toHaveBeenCalledTimes(8);
  });

  it('skips a template that already has enough future occurrences (idempotent, no dupes)', async () => {
    templateModel.findAll.mockResolvedValue([makeTemplate()]);
    instanceModel.count.mockResolvedValue(8); // horizon already satisfied

    const result = await service.generateDueRecurringForAll(new Date());

    expect(result.templatesToppedUp).toBe(0);
    expect(result.created).toBe(0);
    expect(instanceModel.create).not.toHaveBeenCalled();
  });
});
