/* eslint-disable @typescript-eslint/unbound-method -- jest assertion idiom expects on the mock spy reference; safe in tests. */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import { ClientService } from './client.service';
import { ClientDirection } from './dto/list-clients.dto';
import {
  ClientRequest,
  ClientRequestStatus,
  ClientRequestType,
} from './entities/client-request.entity';
import {
  InstructorClient,
  InstructorClientStatus,
} from './entities/instructor-client.entity';
import { InstructorProfile } from '../profile/entities/instructor-profile.entity';
import { RoleService } from '../role/role.service';
import { EmailService } from '../../common/services/email.service';
import { NotificationService } from '../notification/notification.service';
import { User } from '../user/entities/user.entity';
import {
  makeModelMock,
  makeSilentLogger,
  type ModelMock,
} from '../../../test/helpers/sequelize-mocks';

/**
 * Smoke coverage for the client/instructor relationship state machine
 * — request, accept, decline, leave. These flows decide who can see
 * whose health/training data, so a regression here has real privacy
 * impact. The full coverage (notes, listing, archived bookkeeping)
 * is left as an incremental task.
 *
 * Note: ClientService also calls `User.findByPk` as a static method
 * (not via an injected model) for some lookups. We `jest.spyOn(User,
 * 'findByPk')` per test where that path matters.
 */
describe('ClientService', () => {
  let service: ClientService;
  let instructorClientModel: ModelMock;
  let clientRequestModel: ModelMock;
  let instructorProfileModel: ModelMock;
  let roleService: { userHasRole: jest.Mock };
  let emailService: {
    sendClientRequestToInstructorEmail: jest.Mock;
    sendClientRequestAcceptedEmail: jest.Mock;
    sendClientRequestDeclinedEmail: jest.Mock;
    sendClientCollaborationEndedEmail: jest.Mock;
  };
  let notificationService: { notify: jest.Mock };

  const sequelizeMock = {
    transaction: jest.fn((cb: (tx: unknown) => unknown) =>
      Promise.resolve(cb({})),
    ),
  };

  beforeEach(async () => {
    sequelizeMock.transaction.mockClear();

    instructorClientModel = makeModelMock();
    clientRequestModel = makeModelMock();
    instructorProfileModel = makeModelMock();
    roleService = { userHasRole: jest.fn().mockResolvedValue(true) };
    emailService = {
      sendClientRequestToInstructorEmail: jest
        .fn()
        .mockResolvedValue(undefined),
      sendClientRequestAcceptedEmail: jest.fn().mockResolvedValue(undefined),
      sendClientRequestDeclinedEmail: jest.fn().mockResolvedValue(undefined),
      sendClientCollaborationEndedEmail: jest.fn().mockResolvedValue(undefined),
    };
    notificationService = { notify: jest.fn().mockResolvedValue(undefined) };

    // Default: User.findByPk returns a generic profile so the email +
    // notification side-effects can run without crashing.
    jest.spyOn(User, 'findByPk').mockResolvedValue({
      id: 'u-generic',
      email: 'u@x.com',
      firstName: 'Test',
      lastName: 'User',
    } as User);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ClientService,
        {
          provide: getModelToken(InstructorClient),
          useValue: instructorClientModel,
        },
        {
          provide: getModelToken(ClientRequest),
          useValue: clientRequestModel,
        },
        {
          provide: getModelToken(InstructorProfile),
          useValue: instructorProfileModel,
        },
        { provide: Sequelize, useValue: sequelizeMock },
        { provide: RoleService, useValue: roleService },
        { provide: EmailService, useValue: emailService },
        { provide: NotificationService, useValue: notificationService },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = moduleRef.get(ClientService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // =====================================================================
  // Coach notes stay with the coach
  // =====================================================================
  describe('private coaching notes', () => {
    it('never selects notes when a client lists their instructors', async () => {
      instructorClientModel.findAll.mockResolvedValue([]);

      await service.getMyInstructors('cli-1');

      const opts = instructorClientModel.findAll.mock.calls[0][0];
      expect(opts.attributes).toBeDefined();
      expect(opts.attributes).not.toContain('notes');
    });

    it('omits notes from the body returned when a client leaves', async () => {
      instructorClientModel.findOne.mockResolvedValue({
        id: 'ic-1',
        instructorId: 'inst-1',
        clientId: 'cli-1',
        status: InstructorClientStatus.ACTIVE,
        startedAt: new Date(),
        notes: 'knee gives her trouble on squats',
        instructor: {
          id: 'inst-1',
          firstName: 'A',
          lastName: 'B',
          email: 'a@x.com',
        },
        client: {
          id: 'cli-1',
          firstName: 'C',
          lastName: 'D',
          email: 'c@x.com',
        },
        update: jest.fn().mockResolvedValue(undefined),
      });

      const result = await service.leaveInstructor('cli-1', 'inst-1');

      expect(result).not.toHaveProperty('notes');
      expect(JSON.stringify(result)).not.toContain('knee gives her trouble');
    });
  });

  // =====================================================================
  // getClientForInstructor
  // =====================================================================
  describe('getClientForInstructor', () => {
    it('scopes the lookup to the asking instructor', async () => {
      instructorClientModel.findOne.mockResolvedValue({
        id: 'ic-1',
        instructorId: 'inst-1',
        clientId: 'cli-1',
        status: InstructorClientStatus.ACTIVE,
        client: { id: 'cli-1', firstName: 'A', lastName: 'B' },
        createdAt: new Date(),
      });

      await service.getClientForInstructor('inst-1', 'cli-1');

      expect(instructorClientModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { instructorId: 'inst-1', clientId: 'cli-1' },
        }),
      );
    });

    it("404s on someone else's client rather than revealing the link exists", async () => {
      instructorClientModel.findOne.mockResolvedValue(null);

      await expect(
        service.getClientForInstructor('inst-1', 'not-mine'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  // =====================================================================
  // requestToBeClient
  // =====================================================================
  describe('requestToBeClient', () => {
    it('rejects self-request with 400', async () => {
      jest.spyOn(User, 'findByPk').mockResolvedValueOnce({
        id: 'u-1',
        firstName: 'Alex',
        lastName: 'Test',
      } as User);

      await expect(
        service.requestToBeClient('u-1', 'u-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when target is not an instructor', async () => {
      roleService.userHasRole.mockResolvedValueOnce(false);

      await expect(
        service.requestToBeClient('user-1', 'not-instructor'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when instructor is not accepting clients', async () => {
      instructorProfileModel.findOne.mockResolvedValue({
        getDataValue: jest.fn().mockReturnValue(false),
      });

      await expect(
        service.requestToBeClient('user-1', 'instr-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects when an active relationship already exists', async () => {
      instructorProfileModel.findOne.mockResolvedValue({
        getDataValue: jest.fn().mockReturnValue(true),
      });
      instructorClientModel.findOne.mockResolvedValue({
        status: InstructorClientStatus.ACTIVE,
      });

      await expect(
        service.requestToBeClient('user-1', 'instr-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates a CLIENT_TO_INSTRUCTOR request and notifies the instructor', async () => {
      instructorProfileModel.findOne.mockResolvedValue({
        getDataValue: jest.fn().mockReturnValue(true),
      });
      instructorClientModel.findOne.mockResolvedValue(null);
      clientRequestModel.findOne.mockResolvedValue(null);
      const created = { id: 'r-1', fromUserId: 'user-1', toUserId: 'instr-1' };
      clientRequestModel.create.mockResolvedValue(created);

      const result = await service.requestToBeClient('user-1', 'instr-1');

      expect(result).toBe(created);
      expect(clientRequestModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          fromUserId: 'user-1',
          toUserId: 'instr-1',
          type: ClientRequestType.CLIENT_TO_INSTRUCTOR,
          status: ClientRequestStatus.PENDING,
        }),
      );
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'instr-1' }),
      );
    });
  });

  // =====================================================================
  // acceptRequest
  // =====================================================================
  describe('acceptRequest', () => {
    function pendingRequest(overrides: Partial<ClientRequest> = {}) {
      return {
        id: 'r-1',
        fromUserId: 'requester-1',
        toUserId: 'recipient-1',
        type: ClientRequestType.CLIENT_TO_INSTRUCTOR,
        status: ClientRequestStatus.PENDING,
        expiresAt: new Date(Date.now() + 86_400_000),
        update: jest.fn().mockResolvedValue(undefined),
        ...overrides,
      } as unknown as ClientRequest;
    }

    it('only the recipient can accept (403 otherwise)', async () => {
      clientRequestModel.findByPk.mockResolvedValue(pendingRequest());

      await expect(
        service.acceptRequest('r-1', 'someone-else'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects an expired request with 400', async () => {
      const expired = pendingRequest({
        expiresAt: new Date(Date.now() - 86_400_000),
      });
      clientRequestModel.findByPk.mockResolvedValue(expired);

      await expect(
        service.acceptRequest('r-1', 'recipient-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects an already-accepted request with 400', async () => {
      clientRequestModel.findByPk.mockResolvedValue(
        pendingRequest({ status: ClientRequestStatus.ACCEPTED }),
      );

      await expect(
        service.acceptRequest('r-1', 'recipient-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('flips the request and creates an ACTIVE relationship', async () => {
      const request = pendingRequest();
      clientRequestModel.findByPk.mockResolvedValue(request);
      // No prior relationship row inside the tx.
      instructorClientModel.findOne.mockResolvedValue(null);
      instructorClientModel.create.mockResolvedValue(undefined);

      const result = await service.acceptRequest('r-1', 'recipient-1');

      expect(result.message).toMatch(/accepted/i);
      expect(request.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: ClientRequestStatus.ACCEPTED }),
        expect.any(Object),
      );
      expect(instructorClientModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          status: InstructorClientStatus.ACTIVE,
        }),
        expect.any(Object),
      );
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'requester-1' }),
      );
      // A client's request was accepted: the email speaks to a client.
      await new Promise(setImmediate);
      expect(emailService.sendClientRequestAcceptedEmail).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.any(String),
        'client',
        'en',
      );
    });

    it('tells a coach their invitation was accepted, in their language', async () => {
      clientRequestModel.findByPk.mockResolvedValue(
        pendingRequest({ type: ClientRequestType.INSTRUCTOR_TO_CLIENT }),
      );
      instructorClientModel.findOne.mockResolvedValue(null);
      instructorClientModel.create.mockResolvedValue(undefined);
      jest.spyOn(User, 'findByPk').mockResolvedValue({
        email: 'coach@x.io',
        firstName: 'Dan',
        lastName: 'Ionescu',
        language: 'ro',
      } as User);

      await service.acceptRequest('r-1', 'recipient-1');
      await new Promise(setImmediate);

      expect(emailService.sendClientRequestAcceptedEmail).toHaveBeenCalledWith(
        'coach@x.io',
        'Dan',
        'Dan Ionescu',
        'instructor',
        'ro',
      );
    });
  });

  // =====================================================================
  // declineRequest
  // =====================================================================
  describe('declineRequest', () => {
    it('only the recipient can decline (403 otherwise)', async () => {
      clientRequestModel.findByPk.mockResolvedValue({
        id: 'r-1',
        fromUserId: 'a',
        toUserId: 'recipient-1',
        type: ClientRequestType.CLIENT_TO_INSTRUCTOR,
        status: ClientRequestStatus.PENDING,
        update: jest.fn(),
      });

      await expect(
        service.declineRequest('r-1', 'someone-else'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('marks DECLINED, deletes any PENDING relationship row, and notifies sender', async () => {
      const update = jest.fn().mockResolvedValue(undefined);
      clientRequestModel.findByPk.mockResolvedValue({
        id: 'r-1',
        fromUserId: 'sender-1',
        toUserId: 'recipient-1',
        type: ClientRequestType.INSTRUCTOR_TO_CLIENT,
        status: ClientRequestStatus.PENDING,
        update,
      });
      instructorClientModel.destroy.mockResolvedValue(1);

      const result = await service.declineRequest('r-1', 'recipient-1');

      expect(result.message).toMatch(/declined/i);
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({ status: ClientRequestStatus.DECLINED }),
      );
      expect(instructorClientModel.destroy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: InstructorClientStatus.PENDING,
          }),
        }),
      );
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'sender-1' }),
      );
      // The sender was the coach (an invitation): the email says so.
      await new Promise(setImmediate);
      expect(emailService.sendClientRequestDeclinedEmail).toHaveBeenCalledWith(
        expect.any(String),
        expect.anything(),
        expect.any(String),
        'instructor',
        'en',
      );
    });
  });

  // =====================================================================
  // leaveInstructor
  // =====================================================================
  describe('leaveInstructor', () => {
    function activeRel(overrides: Partial<InstructorClient> = {}) {
      return {
        id: 'rel-1',
        instructorId: 'instr-1',
        clientId: 'client-1',
        status: InstructorClientStatus.ACTIVE,
        client: {
          firstName: 'Casey',
          lastName: 'Client',
          email: 'casey@x.com',
        },
        instructor: {
          firstName: 'Iris',
          lastName: 'Inst',
          email: 'iris@x.com',
        },
        update: jest.fn().mockResolvedValue(undefined),
        ...overrides,
      } as unknown as InstructorClient;
    }

    it('archives the relationship and notifies the instructor', async () => {
      const rel = activeRel();
      instructorClientModel.findOne.mockResolvedValue(rel);

      const result = await service.leaveInstructor('client-1', 'instr-1');

      // A confirmation, not the entity — the row carries the coach's
      // private notes and the caller here is the client.
      expect(result).toMatchObject({
        id: rel.id,
        instructorId: rel.instructorId,
      });
      expect(rel.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: InstructorClientStatus.ARCHIVED,
        }),
      );
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'instr-1' }),
      );
    });

    it('returns 404 when no relationship exists', async () => {
      instructorClientModel.findOne.mockResolvedValue(null);

      await expect(
        service.leaveInstructor('client-1', 'instr-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects re-leaving an already-archived relationship with 400', async () => {
      instructorClientModel.findOne.mockResolvedValue(
        activeRel({ status: InstructorClientStatus.ARCHIVED }),
      );

      await expect(
        service.leaveInstructor('client-1', 'instr-1'),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
  // =====================================================================
  // Listing: direction, search, and a count that explains itself
  // =====================================================================
  describe('client list', () => {
    const NOW = new Date('2026-09-21T10:00:00.000Z');

    /** A `client_request` row as the includes hydrate it. */
    const request = (over: Record<string, unknown> = {}) => ({
      id: 'req-1',
      type: ClientRequestType.INSTRUCTOR_TO_CLIENT,
      status: ClientRequestStatus.PENDING,
      message: null,
      invitedEmail: null,
      createdAt: NOW,
      updatedAt: NOW,
      expiresAt: new Date('2026-10-21T10:00:00.000Z'),
      fromUser: null,
      toUser: null,
      ...over,
    });

    const user = (over: Record<string, unknown> = {}) => ({
      id: 'u-1',
      firstName: 'Anna',
      lastName: 'Popescu',
      email: 'anna@example.com',
      handle: null,
      avatarId: null,
      avatarUrl: null,
      ...over,
    });

    describe('pending request count', () => {
      it('reports each direction, not just a total that cannot be explained', async () => {
        // One invitation sent, no incoming requests. The bare total read as
        // "1 pending" over a list of incoming requests that was empty.
        clientRequestModel.count
          .mockResolvedValueOnce(1) // outgoing
          .mockResolvedValueOnce(0); // incoming

        await expect(
          service.getPendingRequestsCount('inst-1'),
        ).resolves.toEqual({ count: 1, incoming: 0, outgoing: 1 });
      });

      it('keeps `count` meaning both directions so existing callers are unaffected', async () => {
        clientRequestModel.count
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(3);

        await expect(
          service.getPendingRequestsCount('inst-1'),
        ).resolves.toEqual({ count: 5, incoming: 3, outgoing: 2 });
      });
    });

    describe('direction filter', () => {
      it('narrows to incoming requests and leaves settled relationships out', async () => {
        clientRequestModel.findAll.mockResolvedValue([]);

        await service.getMyClients('inst-1', {
          direction: ClientDirection.INCOMING,
        });

        // Only a pending row has a direction, so the settled table is not read.
        expect(instructorClientModel.findAll).not.toHaveBeenCalled();
        expect(instructorClientModel.findAndCountAll).not.toHaveBeenCalled();

        const where = clientRequestModel.findAll.mock.calls[0][0].where;
        const directions = where[Object.getOwnPropertySymbols(where)[0]];
        expect(directions).toEqual([
          { toUserId: 'inst-1', type: ClientRequestType.CLIENT_TO_INSTRUCTOR },
        ]);
      });

      it('narrows to the invitations the coach sent', async () => {
        clientRequestModel.findAll.mockResolvedValue([]);

        await service.getMyClients('inst-1', {
          direction: ClientDirection.OUTGOING,
        });

        const where = clientRequestModel.findAll.mock.calls[0][0].where;
        const directions = where[Object.getOwnPropertySymbols(where)[0]];
        expect(directions).toEqual([
          {
            fromUserId: 'inst-1',
            type: ClientRequestType.INSTRUCTOR_TO_CLIENT,
          },
        ]);
      });

      it('asks for both directions when none is given', async () => {
        clientRequestModel.findAll.mockResolvedValue([]);

        await service.getMyClients('inst-1', {
          status: InstructorClientStatus.PENDING,
        });

        const where = clientRequestModel.findAll.mock.calls[0][0].where;
        const directions = where[Object.getOwnPropertySymbols(where)[0]];
        expect(directions).toHaveLength(2);
      });
    });

    describe('search', () => {
      it('pushes the term into the query that paginates, not after it', async () => {
        await service.getMyClients('inst-1', {
          status: InstructorClientStatus.ACTIVE,
          search: 'anna popescu',
        });

        const include =
          instructorClientModel.findAndCountAll.mock.calls[0][0].include[0];
        // INNER JOIN, so `total` counts matches rather than the whole roster.
        expect(include.required).toBe(true);
        // One AND-ed group per token: both have to land somewhere.
        const and =
          include.where[Object.getOwnPropertySymbols(include.where)[0]];
        expect(and).toHaveLength(2);
      });

      it('leaves the join alone when there is no term to search for', async () => {
        await service.getMyClients('inst-1', {
          status: InstructorClientStatus.ACTIVE,
        });

        const include =
          instructorClientModel.findAndCountAll.mock.calls[0][0].include[0];
        expect(include.required).toBeUndefined();
        expect(include.where).toBeUndefined();
      });

      it('ignores a one-character term rather than matching most of the roster', async () => {
        await service.getMyClients('inst-1', {
          status: InstructorClientStatus.ACTIVE,
          search: 'a',
        });

        const include =
          instructorClientModel.findAndCountAll.mock.calls[0][0].include[0];
        expect(include.where).toBeUndefined();
      });

      it('matches a pending row on the address an email-only invite went to', async () => {
        clientRequestModel.findAll.mockResolvedValue([
          request({ id: 'req-email', invitedEmail: 'radu@example.com' }),
          request({ id: 'req-user', toUser: user() }),
        ]);

        const result = await service.getMyClients('inst-1', {
          status: InstructorClientStatus.PENDING,
          search: 'radu',
        });

        expect(result.items.map((row) => row.id)).toEqual(['req-email']);
        expect(result.total).toBe(1);
      });

      it('matches a pending row across first and last name', async () => {
        clientRequestModel.findAll.mockResolvedValue([
          request({ id: 'req-anna', toUser: user() }),
          request({
            id: 'req-elena',
            toUser: user({
              id: 'u-2',
              firstName: 'Elena',
              lastName: 'Dumitru',
              email: 'elena@example.com',
            }),
          }),
        ]);

        const result = await service.getMyClients('inst-1', {
          status: InstructorClientStatus.PENDING,
          search: 'anna popescu',
        });

        expect(result.items.map((row) => row.id)).toEqual(['req-anna']);
      });

      it('reports the matched count, so pagination does not promise rows it filtered out', async () => {
        clientRequestModel.findAll.mockResolvedValue([
          request({ id: 'a', toUser: user() }),
          request({ id: 'b', toUser: user({ id: 'u-2', firstName: 'Zed' }) }),
        ]);

        const result = await service.getMyClients('inst-1', {
          status: InstructorClientStatus.PENDING,
          search: 'zed',
        });

        expect(result.total).toBe(1);
        expect(result.items).toHaveLength(1);
      });
    });
  });
});
