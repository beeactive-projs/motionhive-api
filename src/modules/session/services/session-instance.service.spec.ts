import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op } from 'sequelize';
import { SessionInstanceService } from './session-instance.service';
import { SessionAccessService } from './session-access.service';
import { SessionInstance } from '../entities/session-instance.entity';
import { SessionParticipant } from '../entities/session-participant.entity';
import { SessionAccess } from '../entities/session.enums';
import { makeSilentLogger } from '../../../../test/helpers/sequelize-mocks';

function makeInstanceModelMock() {
  return {
    findOne: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
  };
}

function makeParticipantModelMock() {
  return {
    findOne: jest.fn(),
    findAll: jest.fn(),
    findAndCountAll: jest.fn(),
  };
}

function makeAccessServiceMock() {
  return { evaluate: jest.fn() };
}

describe('SessionInstanceService', () => {
  let service: SessionInstanceService;
  let instanceMock: ReturnType<typeof makeInstanceModelMock>;
  let participantMock: ReturnType<typeof makeParticipantModelMock>;
  let accessMock: ReturnType<typeof makeAccessServiceMock>;

  beforeEach(async () => {
    instanceMock = makeInstanceModelMock();
    participantMock = makeParticipantModelMock();
    accessMock = makeAccessServiceMock();

    const module = await Test.createTestingModule({
      providers: [
        SessionInstanceService,
        { provide: getModelToken(SessionInstance), useValue: instanceMock },
        {
          provide: getModelToken(SessionParticipant),
          useValue: participantMock,
        },
        { provide: SessionAccessService, useValue: accessMock },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = module.get(SessionInstanceService);
  });

  describe('list', () => {
    it('B1: instructor sees their own instances (no participant join)', async () => {
      instanceMock.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.list('usr-1', { page: 1, limit: 20 });

      const call = instanceMock.findAndCountAll.mock.calls[0][0] as {
        where: Record<string, unknown>;
        include: { as?: string; required?: boolean }[];
      };
      expect(call.where['instructorId']).toBe('usr-1');
      // include must not have the participant filter when caller === target
      const hasParticipantJoin = call.include.some(
        (i) => i.as === 'participants' && i.required === true,
      );
      expect(hasParticipantJoin).toBe(false);
    });

    it('B1a: clientId narrows the own-calendar view to that person', async () => {
      instanceMock.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.list('usr-1', {
        page: 1,
        limit: 20,
        clientId: 'cli-9',
      });

      const call = instanceMock.findAndCountAll.mock.calls[0][0] as {
        where: Record<string, unknown>;
        include: {
          as?: string;
          required?: boolean;
          where?: Record<string, unknown>;
        }[];
      };
      // Still the caller's own calendar — the filter narrows, never widens.
      expect(call.where['instructorId']).toBe('usr-1');
      const partJoin = call.include.find((i) => i.as === 'participants');
      expect(partJoin?.required).toBe(true);
      expect(partJoin?.where?.['userId']).toBe('cli-9');
    });

    it('B1b: clientId is ignored when viewing another instructor', async () => {
      instanceMock.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.list('usr-1', {
        page: 1,
        limit: 20,
        instructorId: 'usr-other',
        clientId: 'cli-9',
      });

      const call = instanceMock.findAndCountAll.mock.calls[0][0] as {
        include: { as?: string; where?: Record<string, unknown> }[];
      };
      // Cross-instructor stays scoped to the caller — you cannot use
      // clientId to read someone else's roster through another coach.
      const partJoin = call.include.find((i) => i.as === 'participants');
      expect(partJoin?.where?.['userId']).toBe('usr-1');
    });

    it('B2: cross-instructor view requires participant join (scoped to caller)', async () => {
      instanceMock.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });

      await service.list('usr-1', {
        page: 1,
        limit: 20,
        instructorId: 'usr-other',
      });

      const call = instanceMock.findAndCountAll.mock.calls[0][0] as {
        where: Record<string, unknown>;
        include: {
          as?: string;
          required?: boolean;
          where?: Record<string, unknown>;
        }[];
      };
      expect(call.where['instructorId']).toBe('usr-other');
      const partJoin = call.include.find((i) => i.as === 'participants');
      expect(partJoin).toBeDefined();
      expect(partJoin?.required).toBe(true);
      expect(partJoin?.where?.['userId']).toBe('usr-1');
    });

    it('B6: list issues exactly ONE findAndCountAll (no N+1)', async () => {
      instanceMock.findAndCountAll.mockResolvedValue({
        rows: Array.from({ length: 50 }, (_, i) => ({ id: `inst-${i}` })),
        count: 50,
      });

      await service.list('usr-1', { page: 1, limit: 50 });

      expect(instanceMock.findAndCountAll).toHaveBeenCalledTimes(1);
      // No follow-up per-row queries.
      expect(instanceMock.findOne).not.toHaveBeenCalled();
      expect(participantMock.findOne).not.toHaveBeenCalled();
      expect(participantMock.findAndCountAll).not.toHaveBeenCalled();
    });

    it('B7: rejects date range > 180 days', async () => {
      await expect(
        service.list('usr-1', {
          page: 1,
          limit: 20,
          dateFrom: '2026-01-01T00:00:00Z',
          dateTo: '2027-01-01T00:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('B7b: rejects dateFrom >= dateTo', async () => {
      await expect(
        service.list('usr-1', {
          page: 1,
          limit: 20,
          dateFrom: '2026-06-10T00:00:00Z',
          dateTo: '2026-06-10T00:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('list applies templateId + status filters when present', async () => {
      instanceMock.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
      await service.list('usr-1', {
        page: 1,
        limit: 20,
        templateId: '11111111-1111-1111-1111-111111111111',
        status: 'SCHEDULED',
      });
      const call = instanceMock.findAndCountAll.mock.calls[0][0] as {
        where: Record<string, unknown>;
      };
      expect(call.where['templateId']).toBe(
        '11111111-1111-1111-1111-111111111111',
      );
      expect(call.where['status']).toBe('SCHEDULED');
    });

    it('uses startAt date window with Op.gte / Op.lt', async () => {
      instanceMock.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
      await service.list('usr-1', {
        page: 1,
        limit: 20,
        dateFrom: '2026-06-01T00:00:00Z',
        dateTo: '2026-06-08T00:00:00Z',
      });
      const where = (
        instanceMock.findAndCountAll.mock.calls[0][0] as {
          where: { startAt: Record<symbol, unknown> };
        }
      ).where;
      expect(where.startAt[Op.gte]).toEqual(new Date('2026-06-01T00:00:00Z'));
      expect(where.startAt[Op.lt]).toEqual(new Date('2026-06-08T00:00:00Z'));
    });

    it('sorts oldest first unless asked for the most recent first', async () => {
      instanceMock.findAndCountAll.mockResolvedValue({ rows: [], count: 0 });
      await service.list('usr-1', { page: 1, limit: 5 });
      await service.list('usr-1', { page: 1, limit: 5, order: 'desc' });
      const orders = instanceMock.findAndCountAll.mock.calls.map(
        ([call]) => (call as { order: unknown }).order,
      );
      expect(orders).toEqual([[['startAt', 'ASC']], [['startAt', 'DESC']]]);
    });
  });

  describe('getById', () => {
    const fakeInstance = (overrides?: Record<string, unknown>) => {
      const data: Record<string, unknown> = {
        id: 'inst-1',
        instructorId: 'usr-1',
        template: {
          access: SessionAccess.Open,
          instructorId: 'usr-1',
          groupId: null,
        },
        ...overrides,
      };
      return {
        ...data,
        setDataValue: jest.fn((k: string, v: unknown) => {
          data[k] = v;
        }),
      };
    };

    it('B3: returns OPEN instance to any authed caller', async () => {
      instanceMock.findOne.mockResolvedValue(fakeInstance());
      accessMock.evaluate.mockResolvedValue({
        canView: true,
        isOwner: false,
        isParticipant: false,
        isEligible: true,
      });

      const result = await service.getById('usr-other', 'inst-1');
      expect(result).toBeDefined();
      expect(participantMock.findAll).not.toHaveBeenCalled();
    });

    it('B4: hides GROUP_ONLY from non-member (404, not 403)', async () => {
      instanceMock.findOne.mockResolvedValue(
        fakeInstance({
          template: {
            access: SessionAccess.GroupOnly,
            instructorId: 'usr-1',
            groupId: 'grp-1',
          },
        }),
      );
      accessMock.evaluate.mockResolvedValue({
        canView: false,
        isOwner: false,
        isParticipant: false,
        isEligible: false,
      });

      await expect(service.getById('usr-other', 'inst-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('B5: owner gets first 10 participants attached', async () => {
      const inst = fakeInstance();
      instanceMock.findOne.mockResolvedValue(inst);
      accessMock.evaluate.mockResolvedValue({
        canView: true,
        isOwner: true,
        isParticipant: false,
        isEligible: false,
      });
      participantMock.findAll.mockResolvedValue([
        { id: 'p-1', userId: 'u-1' },
        { id: 'p-2', userId: 'u-2' },
      ]);

      const result = await service.getById('usr-1', 'inst-1');
      expect(participantMock.findAll).toHaveBeenCalledTimes(1);
      const callArgs = participantMock.findAll.mock.calls[0][0] as {
        limit: number;
        attributes: string[];
      };
      expect(callArgs.limit).toBe(10);
      expect(callArgs.attributes).toContain('privateNote');
      expect(result).toBeDefined();
      expect(inst.setDataValue).toHaveBeenCalledWith(
        'participants',
        expect.any(Array),
      );
    });

    it('returns 404 when row not found', async () => {
      instanceMock.findOne.mockResolvedValue(null);
      await expect(service.getById('usr-1', 'inst-x')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listParticipants', () => {
    it('B8: returns 404 for cross-instructor caller (no existence leak)', async () => {
      instanceMock.findOne.mockResolvedValue(null);
      await expect(
        service.listParticipants('usr-other', 'inst-1', {
          page: 1,
          limit: 20,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('owner-only path: returns paginated participants with eager user', async () => {
      instanceMock.findOne.mockResolvedValue({ id: 'inst-1' });
      participantMock.findAndCountAll.mockResolvedValue({
        rows: [{ id: 'p-1' }, { id: 'p-2' }],
        count: 2,
      });
      const result = await service.listParticipants('usr-1', 'inst-1', {
        page: 1,
        limit: 20,
      });
      expect(result.total).toBe(2);
      expect(participantMock.findAndCountAll).toHaveBeenCalledTimes(1);
    });
  });
});
