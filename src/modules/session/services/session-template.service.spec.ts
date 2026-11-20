import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { SessionTemplateService } from './session-template.service';
import { RecurrenceService } from './recurrence.service';
import { SessionTemplate } from '../entities/session-template.entity';
import { SessionInstance } from '../entities/session-instance.entity';
import {
  SessionInstanceStatus,
  SessionTemplateStatus,
} from '../entities/session.enums';
import { VenueService } from '../../venue/venue.service';
import { GroupService } from '../../group/group.service';
import { SearchIndexService } from '../../search/search-index.service';
import { SessionLifecycleService } from './session-lifecycle.service';
import { makeSilentLogger } from '../../../../test/helpers/sequelize-mocks';

const makeTx = () => ({
  commit: jest.fn().mockResolvedValue(undefined),
  rollback: jest.fn().mockResolvedValue(undefined),
});

function makeTemplateMock() {
  return {
    findOne: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    sequelize: { transaction: jest.fn() },
  };
}

function makeInstanceMock() {
  return {
    create: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
  };
}

function makeVenueServiceMock() {
  return { get: jest.fn() };
}

function makeGroupServiceMock() {
  return { getById: jest.fn() };
}

function makeSearchIndexServiceMock() {
  return { upsertSession: jest.fn().mockResolvedValue(undefined) };
}

// Far enough in the future that the future-date guard always passes.
// Computed at test time so it stays valid as the clock advances.
const futureIso = (daysAhead = 30) =>
  new Date(Date.now() + daysAhead * 86_400_000).toISOString();

const makeValidDto = () => ({
  title: 'Morning Yoga',
  type: 'GROUP' as const,
  access: 'OPEN' as const,
  locationKind: 'IN_PERSON' as const,
  durationMinutes: 60,
  timezone: 'Europe/Bucharest',
  isRecurring: false,
  firstStartAt: futureIso(30),
});

describe('SessionTemplateService', () => {
  let service: SessionTemplateService;
  let templateMock: ReturnType<typeof makeTemplateMock>;
  let instanceMock: ReturnType<typeof makeInstanceMock>;
  let venueServiceMock: ReturnType<typeof makeVenueServiceMock>;
  let groupServiceMock: ReturnType<typeof makeGroupServiceMock>;
  let searchIndexServiceMock: ReturnType<typeof makeSearchIndexServiceMock>;
  let lifecycleMock: { promoteAfterSeriesCapacityRaise: jest.Mock };

  beforeEach(async () => {
    lifecycleMock = {
      promoteAfterSeriesCapacityRaise: jest.fn().mockResolvedValue(0),
    };
    templateMock = makeTemplateMock();
    instanceMock = makeInstanceMock();
    venueServiceMock = makeVenueServiceMock();
    groupServiceMock = makeGroupServiceMock();
    searchIndexServiceMock = makeSearchIndexServiceMock();

    const module = await Test.createTestingModule({
      providers: [
        SessionTemplateService,
        RecurrenceService,
        { provide: getModelToken(SessionTemplate), useValue: templateMock },
        { provide: getModelToken(SessionInstance), useValue: instanceMock },
        { provide: VenueService, useValue: venueServiceMock },
        { provide: GroupService, useValue: groupServiceMock },
        { provide: SearchIndexService, useValue: searchIndexServiceMock },
        { provide: SessionLifecycleService, useValue: lifecycleMock },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = module.get(SessionTemplateService);
  });

  describe('create', () => {
    it('creates a one-off template + 1 instance', async () => {
      const dto = makeValidDto();
      const tx = makeTx();
      templateMock.sequelize.transaction.mockResolvedValue(tx);
      templateMock.findOne.mockResolvedValue(null); // no slug collision

      const fakeTemplate = {
        id: 'tmpl-1',
        instructorId: 'usr-1',
        durationMinutes: 60,
        firstStartAt: new Date(dto.firstStartAt),
        isRecurring: false,
        recurrenceRule: null,
        timezone: 'Europe/Bucharest',
        update: jest.fn(),
      };
      templateMock.create.mockResolvedValue(fakeTemplate);

      const fakeInstance = { id: 'inst-1', occurrenceIndex: 0 };
      instanceMock.create.mockResolvedValue(fakeInstance);

      const result = await service.create('usr-1', dto);

      expect(templateMock.create).toHaveBeenCalledTimes(1);
      expect(instanceMock.create).toHaveBeenCalledTimes(1);
      expect(result.generatedInstances).toHaveLength(1);
      expect(result.warnings).toHaveLength(0);
      expect(tx.commit).toHaveBeenCalled();
    });

    it('throws BadRequestException for invalid timezone', async () => {
      await expect(
        service.create('usr-1', {
          ...makeValidDto(),
          timezone: 'Not/A/Timezone',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rolls back tx when create throws', async () => {
      const dto = makeValidDto();
      const tx = makeTx();
      templateMock.sequelize.transaction.mockResolvedValue(tx);
      templateMock.findOne.mockResolvedValue(null);
      templateMock.create.mockRejectedValue(new Error('DB error'));

      await expect(service.create('usr-1', dto)).rejects.toThrow('DB error');
      expect(tx.rollback).toHaveBeenCalled();
    });

    // --- Phase A: regression + new security tests ---

    it('A1: rejects foreign venueId (IDOR) — VenueService throws NotFound', async () => {
      const dto = {
        ...makeValidDto(),
        venueId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      };
      venueServiceMock.get.mockRejectedValue(
        new NotFoundException('Venue not found.'),
      );
      await expect(service.create('usr-1', dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(templateMock.create).not.toHaveBeenCalled();
    });

    it('A2: rejects foreign groupId (IDOR) — GroupService throws NotFound', async () => {
      const dto = {
        ...makeValidDto(),
        access: 'GROUP_ONLY' as const,
        groupId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      };
      groupServiceMock.getById.mockRejectedValue(
        new NotFoundException('Group not found.'),
      );
      await expect(service.create('usr-1', dto)).rejects.toThrow(
        NotFoundException,
      );
      expect(templateMock.create).not.toHaveBeenCalled();
    });

    it('A3: accepts own venueId (regression)', async () => {
      const dto = { ...makeValidDto(), venueId: 'venue-1' };
      const tx = makeTx();
      templateMock.sequelize.transaction.mockResolvedValue(tx);
      templateMock.findOne.mockResolvedValue(null);
      venueServiceMock.get.mockResolvedValue({ id: 'venue-1' });
      templateMock.create.mockResolvedValue({
        id: 'tmpl-1',
        instructorId: 'usr-1',
        durationMinutes: 60,
        firstStartAt: new Date(dto.firstStartAt),
        isRecurring: false,
        recurrenceRule: null,
        timezone: 'Europe/Bucharest',
        update: jest.fn(),
      });
      instanceMock.create.mockResolvedValue({
        id: 'inst-1',
        occurrenceIndex: 0,
      });

      const result = await service.create('usr-1', dto);
      expect(venueServiceMock.get).toHaveBeenCalledWith('usr-1', 'venue-1');
      expect(result.template).toBeDefined();
    });

    it('A4 (service-level): rejects firstStartAt in the past beyond 5min skew', async () => {
      const dto = {
        ...makeValidDto(),
        firstStartAt: new Date(Date.now() - 60 * 60_000).toISOString(),
      };
      await expect(service.create('usr-1', dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('A5 (service-level): accepts firstStartAt within 5min skew window', async () => {
      const dto = {
        ...makeValidDto(),
        firstStartAt: new Date(Date.now() - 60_000).toISOString(),
      };
      const tx = makeTx();
      templateMock.sequelize.transaction.mockResolvedValue(tx);
      templateMock.findOne.mockResolvedValue(null);
      templateMock.create.mockResolvedValue({
        id: 'tmpl-1',
        instructorId: 'usr-1',
        durationMinutes: 60,
        firstStartAt: new Date(dto.firstStartAt),
        isRecurring: false,
        recurrenceRule: null,
        timezone: 'Europe/Bucharest',
      });
      instanceMock.create.mockResolvedValue({
        id: 'inst-1',
        occurrenceIndex: 0,
      });
      await expect(service.create('usr-1', dto)).resolves.toBeDefined();
    });

    it('A6: strips HTML from title before persist', async () => {
      const dto = {
        ...makeValidDto(),
        title: "<script>alert('xss')</script>Hello",
      };
      const tx = makeTx();
      templateMock.sequelize.transaction.mockResolvedValue(tx);
      templateMock.findOne.mockResolvedValue(null);
      templateMock.create.mockResolvedValue({
        id: 'tmpl-1',
        instructorId: 'usr-1',
        durationMinutes: 60,
        firstStartAt: new Date(dto.firstStartAt),
        isRecurring: false,
        recurrenceRule: null,
        timezone: 'Europe/Bucharest',
      });
      instanceMock.create.mockResolvedValue({
        id: 'inst-1',
        occurrenceIndex: 0,
      });

      await service.create('usr-1', dto);

      const created = templateMock.create.mock.calls[0][0] as { title: string };
      expect(created.title).not.toContain('<script>');
      expect(created.title).toContain('Hello');
    });

    it('A6b: rejects when title becomes empty after sanitization', async () => {
      // <script>…</script> is dropped INCLUDING its content (sanitize-html
      // discards by default) → empty title.
      const stripped = { ...makeValidDto(), title: '<script>x</script>' };
      const onlyTags = { ...makeValidDto(), title: '<img/><br/>' };
      await expect(service.create('usr-1', stripped)).rejects.toThrow(
        BadRequestException,
      );
      await expect(service.create('usr-1', onlyTags)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('list', () => {
    it('returns paginated templates for instructor', async () => {
      const rows = [{ id: 'tmpl-1' }, { id: 'tmpl-2' }];
      templateMock.findAndCountAll.mockResolvedValue({ rows, count: 2 });

      const result = await service.list('usr-1', { page: 1, limit: 20 });

      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
      expect(templateMock.findAndCountAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ instructorId: 'usr-1' }),
        }),
      );
    });
  });

  describe('getById', () => {
    it('returns template when found and owned', async () => {
      const tmpl = { id: 'tmpl-1', instructorId: 'usr-1' };
      templateMock.findOne.mockResolvedValue(tmpl);

      const result = await service.getById('usr-1', 'tmpl-1');
      expect(result).toBe(tmpl);
    });

    it('throws NotFoundException when template not found', async () => {
      templateMock.findOne.mockResolvedValue(null);
      await expect(service.getById('usr-1', 'tmpl-999')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when template owned by another instructor', async () => {
      templateMock.findOne.mockResolvedValue(null); // findOne with instructorId filter returns null
      await expect(service.getById('usr-other', 'tmpl-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('applies partial field updates', async () => {
      const tmpl = {
        id: 'tmpl-1',
        instructorId: 'usr-1',
        update: jest.fn().mockImplementation(function (
          this: unknown,
          updates: unknown,
        ) {
          Object.assign(this as object, updates as object);
          return Promise.resolve(this);
        }),
      };
      templateMock.findOne.mockResolvedValue(tmpl);

      const result = await service.update('usr-1', 'tmpl-1', {
        title: 'New Title',
      });

      expect(tmpl.update).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'New Title' }),
      );
      expect(result).toBe(tmpl);
    });

    describe('a capacity change', () => {
      const templateWith = (
        capacity: number | null,
        waitlistEnabled = true,
      ) => ({
        id: 'tmpl-1',
        instructorId: 'usr-1',
        capacity,
        waitlistEnabled,
        update: jest.fn().mockImplementation(function (
          this: unknown,
          updates: unknown,
        ) {
          Object.assign(this as object, updates as object);
          return Promise.resolve(this);
        }),
      });

      it('fills the waitlists when the series gets more seats', async () => {
        templateMock.findOne.mockResolvedValue(templateWith(10));
        await service.update('usr-1', 'tmpl-1', { capacity: 12 });
        expect(
          lifecycleMock.promoteAfterSeriesCapacityRaise,
        ).toHaveBeenCalledWith('tmpl-1');
      });

      it('fills them when the limit is removed', async () => {
        templateMock.findOne.mockResolvedValue(templateWith(10));
        await service.update('usr-1', 'tmpl-1', {
          capacity: null as unknown as number,
        });
        expect(
          lifecycleMock.promoteAfterSeriesCapacityRaise,
        ).toHaveBeenCalledWith('tmpl-1');
      });

      it('moves nobody on a lower or equal capacity, an unlimited series, or no waitlist', async () => {
        templateMock.findOne.mockResolvedValue(templateWith(10));
        await service.update('usr-1', 'tmpl-1', { capacity: 8 });
        templateMock.findOne.mockResolvedValue(templateWith(10));
        await service.update('usr-1', 'tmpl-1', { capacity: 10 });
        templateMock.findOne.mockResolvedValue(templateWith(null));
        await service.update('usr-1', 'tmpl-1', { capacity: 30 });
        templateMock.findOne.mockResolvedValue(templateWith(10, false));
        await service.update('usr-1', 'tmpl-1', { capacity: 30 });
        templateMock.findOne.mockResolvedValue(templateWith(10));
        await service.update('usr-1', 'tmpl-1', { title: 'Renamed' });
        expect(
          lifecycleMock.promoteAfterSeriesCapacityRaise,
        ).not.toHaveBeenCalled();
      });

      it('still saves the change when filling the waitlists fails', async () => {
        const tmpl = templateWith(10);
        templateMock.findOne.mockResolvedValue(tmpl);
        lifecycleMock.promoteAfterSeriesCapacityRaise.mockRejectedValue(
          new Error('db down'),
        );
        await expect(
          service.update('usr-1', 'tmpl-1', { capacity: 12 }),
        ).resolves.toBe(tmpl);
      });
    });

    it('throws BadRequestException for invalid timezone in update', async () => {
      templateMock.findOne.mockResolvedValue({
        id: 'tmpl-1',
        instructorId: 'usr-1',
        update: jest.fn(),
      });
      await expect(
        service.update('usr-1', 'tmpl-1', { timezone: 'Bad/Zone' }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('delete', () => {
    it('ends template and cancels future scheduled instances', async () => {
      const tx = makeTx();
      templateMock.sequelize.transaction.mockResolvedValue(tx);

      const tmpl = {
        id: 'tmpl-1',
        instructorId: 'usr-1',
        update: jest.fn().mockResolvedValue(undefined),
        destroy: jest.fn().mockResolvedValue(undefined),
      };
      templateMock.findOne.mockResolvedValue(tmpl);
      instanceMock.update.mockResolvedValue([0]);

      await service.delete('usr-1', 'tmpl-1');

      expect(instanceMock.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: SessionInstanceStatus.Cancelled }),
        expect.objectContaining({
          where: expect.objectContaining({ templateId: 'tmpl-1' }),
        }),
      );
      expect(tmpl.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: SessionTemplateStatus.Ended }),
        expect.anything(),
      );
      expect(tmpl.destroy).toHaveBeenCalled();
      expect(tx.commit).toHaveBeenCalled();
    });
  });

  describe('previewRecurrence', () => {
    it('returns ISO occurrences array', () => {
      const result = service.previewRecurrence({
        rule: { frequency: 'DAILY', interval: 1, endAfterOccurrences: 3 },
        firstStartAt: '2026-07-01T08:00:00.000Z',
        timezone: 'Europe/Bucharest',
      });

      expect(result.occurrences).toHaveLength(3);
      expect(result.occurrences[0]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });
});
