import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op } from 'sequelize';
import { SessionDiscoverService } from './session-discover.service';
import { SessionAccessService } from './session-access.service';
import { SessionInstance } from '../entities/session-instance.entity';
import { SessionTemplate } from '../entities/session-template.entity';
import { InstructorClient } from '../../client/entities/instructor-client.entity';
import { GroupMember } from '../../group/entities/group-member.entity';
import {
  SessionAccess,
  SessionInstanceStatus,
  SessionTemplateStatus,
} from '../entities/session.enums';
import { foldedLike } from '../../../../test/helpers/folded-search';
import {
  firstCategoryIdsSql,
  firstHasAnyCategorySql,
  type CategorySource,
} from '../../category/category-sql';
import { makeSilentLogger } from '../../../../test/helpers/sequelize-mocks';

describe('SessionDiscoverService', () => {
  let service: SessionDiscoverService;
  let instanceModel: {
    findOne: jest.Mock;
    findAndCountAll: jest.Mock;
    build: jest.Mock;
    sequelize: { escape: jest.Mock };
  };
  let templateModel: { findOne: jest.Mock; build: jest.Mock };
  let clientModel: { findAll: jest.Mock };
  let groupMemberModel: { findAll: jest.Mock };
  let accessService: { evaluate: jest.Mock; wasEverParticipant: jest.Mock };

  beforeEach(async () => {
    instanceModel = {
      findOne: jest.fn(),
      findAndCountAll: jest.fn().mockResolvedValue({ rows: [], count: 0 }),
      build: jest.fn().mockImplementation((data: object) => ({
        ...data,
        setDataValue: jest.fn(),
      })),
      sequelize: {
        escape: jest.fn((value: string) => `'${value.replace(/'/g, "''")}'`),
      },
    };
    templateModel = {
      findOne: jest.fn(),
      build: jest.fn().mockImplementation((data: object) => data),
    };
    clientModel = { findAll: jest.fn().mockResolvedValue([]) };
    groupMemberModel = { findAll: jest.fn().mockResolvedValue([]) };
    accessService = { evaluate: jest.fn(), wasEverParticipant: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        SessionDiscoverService,
        { provide: getModelToken(SessionInstance), useValue: instanceModel },
        { provide: getModelToken(SessionTemplate), useValue: templateModel },
        { provide: getModelToken(InstructorClient), useValue: clientModel },
        { provide: getModelToken(GroupMember), useValue: groupMemberModel },
        { provide: SessionAccessService, useValue: accessService },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = module.get(SessionDiscoverService);
  });

  describe('discover', () => {
    it('E1: anonymous caller sees only OPEN/FREE in the WHERE clause', async () => {
      await service.discover(null, { page: 1, limit: 20 });
      const call = instanceModel.findAndCountAll.mock.calls[0][0] as {
        include: Array<{ where?: Record<string | symbol, unknown> }>;
      };
      const tplWhere = call.include[0].where as {
        [Op.and]: Array<{ [Op.or]: Array<Record<string, unknown>> }>;
      };
      // The first AND clause holds the access OR; for anon → only one OR clause
      const accessOr = tplWhere[Op.and][0][Op.or];
      expect(accessOr).toHaveLength(1);
      const accessClause = accessOr[0] as {
        access: Record<symbol, string[]>;
      };
      expect(accessClause.access[Op.in]).toEqual([
        SessionAccess.Open,
        SessionAccess.Free,
      ]);
      // Did not look up client/group eligibility for anon
      expect(clientModel.findAll).not.toHaveBeenCalled();
      expect(groupMemberModel.findAll).not.toHaveBeenCalled();
    });

    it('E2: authed caller with client relationships → CLIENTS_ONLY clause appears', async () => {
      clientModel.findAll.mockResolvedValue([{ instructorId: 'inst-A' }]);
      groupMemberModel.findAll.mockResolvedValue([]);
      await service.discover('usr-1', { page: 1, limit: 20 });
      const tplWhere = (
        instanceModel.findAndCountAll.mock.calls[0][0] as {
          include: Array<{ where?: Record<string | symbol, unknown> }>;
        }
      ).include[0].where as {
        [Op.and]: Array<{ [Op.or]: Array<Record<string, unknown>> }>;
      };
      const accessOr = tplWhere[Op.and][0][Op.or];
      expect(accessOr).toHaveLength(2);
      const clientsClause = accessOr[1] as {
        access: string;
        instructorId: Record<symbol, string[]>;
      };
      expect(clientsClause.access).toBe(SessionAccess.ClientsOnly);
      expect(clientsClause.instructorId[Op.in]).toEqual(['inst-A']);
    });

    it('E2b: authed caller in groups → GROUP_ONLY clause appears', async () => {
      clientModel.findAll.mockResolvedValue([]);
      groupMemberModel.findAll.mockResolvedValue([{ groupId: 'grp-X' }]);
      await service.discover('usr-1', { page: 1, limit: 20 });
      const tplWhere = (
        instanceModel.findAndCountAll.mock.calls[0][0] as {
          include: Array<{ where?: Record<string | symbol, unknown> }>;
        }
      ).include[0].where as {
        [Op.and]: Array<{ [Op.or]: Array<Record<string, unknown>> }>;
      };
      const groupClause = tplWhere[Op.and][0][Op.or].find(
        (c) => (c as { access: string }).access === SessionAccess.GroupOnly,
      ) as { groupId: Record<symbol, string[]> };
      expect(groupClause).toBeDefined();
      expect(groupClause.groupId[Op.in]).toEqual(['grp-X']);
    });

    it('E3: filters out CANCELLED instances', async () => {
      await service.discover(null, { page: 1, limit: 20 });
      const where = (
        instanceModel.findAndCountAll.mock.calls[0][0] as {
          where: Record<string, unknown>;
        }
      ).where;
      expect(where['status']).toBe(SessionInstanceStatus.Scheduled);
    });

    it('E5: attributes allowlist EXCLUDES meetingUrlOverride and conflictingInstanceIds', async () => {
      await service.discover(null, { page: 1, limit: 20 });
      const attrs = (
        instanceModel.findAndCountAll.mock.calls[0][0] as {
          attributes: string[];
        }
      ).attributes;
      expect(attrs).not.toContain('meetingUrlOverride');
      expect(attrs).not.toContain('conflictingInstanceIds');
      expect(attrs).not.toContain('cancelReason');
      expect(attrs).not.toContain('attendedCount');
    });

    it('E5b: template eager-load attributes EXCLUDE meetingUrl', async () => {
      await service.discover(null, { page: 1, limit: 20 });
      const call = instanceModel.findAndCountAll.mock.calls[0][0] as {
        include: Array<{ attributes?: string[] }>;
      };
      const tplAttrs = call.include[0].attributes as string[];
      expect(tplAttrs).not.toContain('meetingUrl');
      // meetingProvider (label) is safe — confirm it's allowed
      expect(tplAttrs).toContain('meetingProvider');
    });

    it('AUDIT FIX (E-Bug 4): text search + access predicate are ANDed, not OR-overwritten', async () => {
      // The bug was: query.q would overwrite the access [Op.or] with its
      // own [Op.or] (same key), exposing CLIENTS_ONLY to anonymous search.
      await service.discover(null, { page: 1, limit: 20, q: 'yoga' });
      const tplWhere = (
        instanceModel.findAndCountAll.mock.calls[0][0] as {
          include: Array<{ where?: Record<string | symbol, unknown> }>;
        }
      ).include[0].where as {
        [Op.and]: Array<{ [Op.or]: Array<Record<string, unknown>> }>;
      };
      // Two AND groups: access OR, then search OR.
      expect(tplWhere[Op.and]).toHaveLength(2);
      // Access OR still has only OPEN/FREE for anon
      const accessOr = tplWhere[Op.and][0][Op.or];
      expect(accessOr).toHaveLength(1);
      // Search OR has title + description, blind to accents, a % literal
      const searchOr = tplWhere[Op.and][1][Op.or] as unknown as Array<{
        val: string;
      }>;
      expect(searchOr.map((clause) => clause.val)).toEqual([
        foldedLike('"template"."title"', 'yoga'),
        foldedLike('"template"."description"', 'yoga'),
      ]);
    });

    describe('categoryIds filter', () => {
      // A session trains its group's categories, else its coach's.
      const sources: CategorySource[] = [
        { link: 'group', ownerRef: '"template"."group_id"' },
        { link: 'coach', ownerRef: '"template"."instructor_id"' },
      ];
      const quote = (value: string) => `'${value.replace(/'/g, "''")}'`;
      type Query = {
        include: Array<{
          where: Record<symbol, Array<{ val?: string }>>;
          attributes: unknown[];
        }>;
      };
      const templateInclude = () => {
        const [[query]] = instanceModel.findAndCountAll.mock.calls as [[Query]];
        return query.include[0];
      };

      it('matches by the same rule as the categoryIds each row shows', async () => {
        await service.discover(null, {
          page: 1,
          limit: 20,
          categoryIds: ['cat-yoga', 'cat-run'],
        });

        const include = templateInclude();
        const filters = include.where[Op.and]
          .map((clause) => clause.val)
          .filter((sql): sql is string => typeof sql === 'string');
        expect(filters).toEqual([
          firstHasAnyCategorySql(sources, ['cat-yoga', 'cat-run'], quote),
        ]);
        // The group decides; the coach only when the group has none.
        expect(filters[0]).toContain('FROM group_category x');
        expect(filters[0]).toContain(
          'NOT EXISTS (SELECT 1 FROM group_category x WHERE x.group_id = "template"."group_id")',
        );
        expect(filters[0]).toContain('FROM coach_category x');
        expect(instanceModel.sequelize.escape).toHaveBeenCalledWith('cat-run');

        const shown = include.attributes.find(
          (attr) => Array.isArray(attr) && attr[1] === 'categoryIds',
        ) as [{ val: string }, string];
        expect(shown[0].val).toBe(firstCategoryIdsSql(sources));
      });

      it('adds no category condition without the filter', async () => {
        await service.discover(null, { page: 1, limit: 20 });

        const sql = JSON.stringify(templateInclude().where[Op.and]);
        expect(sql).not.toContain('group_category');
      });
    });

    it('E7: rejects date range > 90 days', async () => {
      await expect(
        service.discover(null, {
          page: 1,
          limit: 20,
          dateFrom: '2026-01-01T00:00:00Z',
          dateTo: '2027-01-01T00:00:00Z',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getInstancePublic', () => {
    const fakeInst = (
      template: Partial<SessionTemplate>,
      instance: Partial<SessionInstance> = {},
    ) =>
      ({
        id: 'inst-1',
        templateId: 'tmpl-1',
        instructorId: 'usr-instr',
        occurrenceIndex: 0,
        startAt: new Date(),
        endAt: new Date(),
        status: SessionInstanceStatus.Scheduled,
        template: {
          id: 'tmpl-1',
          status: SessionTemplateStatus.Active,
          access: SessionAccess.Open,
          instructorId: 'usr-instr',
          groupId: null,
          title: 'Yoga',
          ...template,
        } as SessionTemplate,
        instructor: { id: 'usr-instr', firstName: 'A', lastName: 'B' },
        ...instance,
      }) as unknown as SessionInstance;

    it('E6 (OPEN): returns full public shape, no extra access check needed', async () => {
      instanceModel.findOne.mockResolvedValue(fakeInst({}));
      const result = await service.getInstancePublic('inst-1', null);
      expect(result).toBeDefined();
      expect(accessService.evaluate).not.toHaveBeenCalled();
    });

    // Every session notification a client receives points at this endpoint.
    // Filtering the query to SCHEDULED meant those links died the moment the
    // session ended — and the post-session follow-up alert could never work.
    it('lets a participant open a session that has already finished', async () => {
      instanceModel.findOne.mockResolvedValue(
        fakeInst({}, { status: SessionInstanceStatus.Completed }),
      );
      accessService.wasEverParticipant.mockResolvedValue(true);
      await expect(
        service.getInstancePublic('inst-1', 'usr-booked'),
      ).resolves.toBeDefined();
    });

    // Their booking was cancelled, or the coach called the session off. The
    // confirmation notification they still have should open, not 404.
    it('lets someone whose booking was cancelled open it', async () => {
      instanceModel.findOne.mockResolvedValue(
        fakeInst({}, { status: SessionInstanceStatus.Cancelled }),
      );
      accessService.wasEverParticipant.mockResolvedValue(true);
      await expect(
        service.getInstancePublic('inst-1', 'usr-booked'),
      ).resolves.toBeDefined();
    });

    it('404s a finished session for an anonymous caller', async () => {
      instanceModel.findOne.mockResolvedValue(
        fakeInst({}, { status: SessionInstanceStatus.Completed }),
      );
      await expect(service.getInstancePublic('inst-1', null)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('lets the instructor open a session that has already finished', async () => {
      instanceModel.findOne.mockResolvedValue(
        fakeInst({}, { status: SessionInstanceStatus.Completed }),
      );
      accessService.wasEverParticipant.mockResolvedValue(false);
      await expect(
        service.getInstancePublic('inst-1', 'usr-instr'),
      ).resolves.toBeDefined();
    });

    // Discovery must not start advertising finished or cancelled sessions.
    it('still 404s a finished session for someone who was not there', async () => {
      instanceModel.findOne.mockResolvedValue(
        fakeInst({}, { status: SessionInstanceStatus.Completed }),
      );
      accessService.wasEverParticipant.mockResolvedValue(false);
      await expect(
        service.getInstancePublic('inst-1', 'usr-stranger'),
      ).rejects.toThrow(NotFoundException);
    });

    it('still 404s an ended template for a stranger, but not for a participant', async () => {
      instanceModel.findOne.mockResolvedValue(
        fakeInst({ status: SessionTemplateStatus.Ended }),
      );
      accessService.wasEverParticipant.mockResolvedValue(false);
      await expect(
        service.getInstancePublic('inst-1', 'usr-stranger'),
      ).rejects.toThrow(NotFoundException);

      accessService.wasEverParticipant.mockResolvedValue(true);
      await expect(
        service.getInstancePublic('inst-1', 'usr-booked'),
      ).resolves.toBeDefined();
    });

    it('E6b (CLIENTS_ONLY non-client): 404', async () => {
      instanceModel.findOne.mockResolvedValue(
        fakeInst({ access: SessionAccess.ClientsOnly }),
      );
      accessService.evaluate.mockResolvedValue({
        canView: false,
        isOwner: false,
        isParticipant: false,
        isEligible: false,
      });
      await expect(
        service.getInstancePublic('inst-1', 'usr-x'),
      ).rejects.toThrow(NotFoundException);
    });

    it('E6c (GROUP_ONLY non-member): returns plain BLOCKED shape, no PII leak (AUDIT FIX E-Bug 2)', async () => {
      const inst = fakeInst({
        access: SessionAccess.GroupOnly,
        groupId: 'grp-1',
      });
      // Even if the template hypothetically had a meetingUrl, the blocked
      // shape MUST NOT include it.
      (inst.template as unknown as { meetingUrl: string }).meetingUrl =
        'https://zoom.us/j/secret';
      (inst.template as unknown as { description: string }).description =
        'leaky description';
      instanceModel.findOne.mockResolvedValue(inst);
      accessService.evaluate.mockResolvedValue({
        canView: false,
        isOwner: false,
        isParticipant: false,
        isEligible: false,
      });
      const result = await service.getInstancePublic('inst-1', 'usr-x');
      // Plain object now — assert directly that redacted keys are absent.
      expect(result).toMatchObject({
        isBlocked: true,
        template: { title: 'Yoga' },
      });
      const r = result as unknown as Record<string, unknown>;
      expect(JSON.stringify(r)).not.toContain('zoom.us');
      expect(JSON.stringify(r)).not.toContain('leaky description');
      // Also verify our private-fields exclusion stays exact.
      const tpl = r['template'] as Record<string, unknown>;
      expect(tpl['meetingUrl']).toBeUndefined();
      expect(tpl['description']).toBeUndefined();
      expect(tpl['capacity']).toBeUndefined();
    });

    it('returns 404 when instance missing', async () => {
      instanceModel.findOne.mockResolvedValue(null);
      await expect(service.getInstancePublic('inst-x', null)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  // `getBySlug` is not unit-tested here: the path calls a static
  // `User.findOne` that's harder to stub without a wrapper. An
  // integration test (Phase E2 in master plan) covers it end-to-end.
});
