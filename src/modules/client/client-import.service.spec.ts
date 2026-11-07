import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

import {
  CLIENT_IMPORT_DAILY_LIMIT,
  ClientImportRowStatus,
  ClientImportService,
} from './client-import.service';
import { ImportClientsDto } from './dto/import-clients.dto';
import {
  ClientInviteEmailStatus,
  ClientRequest,
  ClientRequestStatus,
  ClientRequestType,
} from './entities/client-request.entity';
import {
  InstructorClient,
  InstructorClientStatus,
} from './entities/instructor-client.entity';
import { EmailService } from '../../common/services/email.service';
import { JobsService } from '../jobs/jobs.service';
import { NotificationService } from '../notification/notification.service';
import { RoleService } from '../role/role.service';
import { User } from '../user/entities/user.entity';
import {
  makeModelMock,
  makeSilentLogger,
  type ModelMock,
} from '../../../test/helpers/sequelize-mocks';

/**
 * Client import: preview and commit share one path, so most of this is
 * "what does each row become". The privacy rule gets its own test: an
 * address with an account and one without must look the same to the
 * coach.
 */
describe('ClientImportService', () => {
  const COACH = {
    id: 'coach-1',
    email: 'Coach@Example.com',
    firstName: 'Dan',
    lastName: 'Ionescu',
    language: 'ro',
  };

  let service: ClientImportService;
  let clientRequestModel: ModelMock & { bulkCreate: jest.Mock };
  let instructorClientModel: ModelMock;
  let roleService: { userHasRole: jest.Mock };
  let emailService: {
    sendClientImportInvitationEmail: jest.Mock;
    previewClientImportInvitationEmail: jest.Mock;
  };
  let notificationService: { notify: jest.Mock };
  let jobs: { enqueue: jest.Mock };
  let findAllUsers: jest.SpyInstance;

  const sequelizeMock = {
    transaction: jest.fn((cb: (tx: unknown) => unknown) =>
      Promise.resolve(cb({})),
    ),
  };

  const dto = (
    rows: ImportClientsDto['rows'],
    extra: Partial<ImportClientsDto> = {},
  ): ImportClientsDto => ({ rows, ...extra });

  /** bulkCreate echoes its rows back with ids, like Sequelize does. */
  const echoBulkCreate = () =>
    clientRequestModel.bulkCreate.mockImplementation(
      (rows: Array<Record<string, unknown>>) =>
        Promise.resolve(rows.map((row, i) => ({ id: `req-${i}`, ...row }))),
    );

  beforeEach(async () => {
    sequelizeMock.transaction.mockClear();
    clientRequestModel = { ...makeModelMock(), bulkCreate: jest.fn() };
    clientRequestModel.findAll.mockResolvedValue([]);
    instructorClientModel = makeModelMock();
    instructorClientModel.findAll.mockResolvedValue([]);
    roleService = { userHasRole: jest.fn().mockResolvedValue(true) };
    emailService = {
      sendClientImportInvitationEmail: jest
        .fn()
        .mockResolvedValue({ ok: true }),
      previewClientImportInvitationEmail: jest
        .fn()
        .mockReturnValue({ subject: 'Subject', html: '<html></html>' }),
    };
    notificationService = { notify: jest.fn().mockResolvedValue(undefined) };
    jobs = { enqueue: jest.fn().mockResolvedValue({ id: 'job' }) };

    jest.spyOn(User, 'findByPk').mockResolvedValue(COACH as User);
    findAllUsers = jest.spyOn(User, 'findAll').mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ClientImportService,
        {
          provide: getModelToken(ClientRequest),
          useValue: clientRequestModel,
        },
        {
          provide: getModelToken(InstructorClient),
          useValue: instructorClientModel,
        },
        { provide: Sequelize, useValue: sequelizeMock },
        { provide: RoleService, useValue: roleService },
        { provide: EmailService, useValue: emailService },
        { provide: NotificationService, useValue: notificationService },
        { provide: JobsService, useValue: jobs },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();

    service = moduleRef.get(ClientImportService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.REDIS_HOST;
  });

  describe('preview', () => {
    it('refuses anyone who is not a coach', async () => {
      roleService.userHasRole.mockResolvedValueOnce(false);
      await expect(
        service.importClients('u-1', dto([{ email: 'a@x.com' }]), true),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('sorts out bad, own and repeated addresses before asking the database', async () => {
      const result = await service.importClients(
        COACH.id,
        dto([
          { email: 'not an email' },
          { email: ' coach@example.COM ' },
          { email: 'Ana@X.com', firstName: '  Ana  ', lastName: 'Pop' },
          { email: 'ana@x.com' },
        ]),
        true,
      );

      expect(result.rows.map((r) => r.status)).toEqual([
        ClientImportRowStatus.INVALID_EMAIL,
        ClientImportRowStatus.SELF,
        ClientImportRowStatus.INVITE,
        ClientImportRowStatus.DUPLICATE,
      ]);
      expect(result.rows[2]).toMatchObject({
        email: 'ana@x.com',
        firstName: 'Ana',
        lastName: 'Pop',
      });
      expect(result.toSend).toBe(1);
      expect(result.counts.INVITE).toBe(1);
    });

    it('marks clients, archived clients, their requests and invites already out', async () => {
      findAllUsers.mockResolvedValue([
        { id: 'u-active', email: 'Active@x.com' },
        { id: 'u-archived', email: 'archived@x.com' },
        { id: 'u-asked', email: 'asked@x.com' },
      ]);
      instructorClientModel.findAll.mockResolvedValue([
        { clientId: 'u-active', status: InstructorClientStatus.ACTIVE },
        { clientId: 'u-archived', status: InstructorClientStatus.ARCHIVED },
      ]);
      const invitedAt = new Date('2026-10-12T09:00:00Z');
      clientRequestModel.findAll.mockResolvedValue([
        {
          type: ClientRequestType.CLIENT_TO_INSTRUCTOR,
          fromUserId: 'u-asked',
          toUserId: COACH.id,
        },
        {
          type: ClientRequestType.INSTRUCTOR_TO_CLIENT,
          fromUserId: COACH.id,
          toUserId: null,
          invitedEmail: 'pending@x.com',
          createdAt: invitedAt,
        },
      ]);

      const result = await service.importClients(
        COACH.id,
        dto([
          { email: 'active@x.com' },
          { email: 'archived@x.com' },
          { email: 'asked@x.com' },
          { email: 'pending@x.com' },
          { email: 'new@x.com' },
        ]),
        true,
      );

      expect(result.rows.map((r) => r.status)).toEqual([
        ClientImportRowStatus.ALREADY_CLIENT,
        ClientImportRowStatus.ARCHIVED_CLIENT,
        ClientImportRowStatus.REQUESTED_YOU,
        ClientImportRowStatus.ALREADY_INVITED,
        ClientImportRowStatus.INVITE,
      ]);
      expect(result.rows[3].invitedAt).toBe(invitedAt);
    });

    it('shows an account holder and a stranger exactly alike', async () => {
      findAllUsers.mockResolvedValue([{ id: 'u-1', email: 'has@x.com' }]);

      const result = await service.importClients(
        COACH.id,
        dto([{ email: 'has@x.com' }, { email: 'none@x.com' }]),
        true,
      );

      const [withAccount, without] = result.rows;
      expect(withAccount.status).toBe(ClientImportRowStatus.INVITE);
      expect(without.status).toBe(ClientImportRowStatus.INVITE);
      expect(Object.keys(withAccount).sort()).toEqual(
        Object.keys(without).sort(),
      );
      expect(JSON.stringify(result)).not.toContain('u-1');
    });

    it('writes and sends nothing', async () => {
      await service.importClients(
        COACH.id,
        dto([{ email: 'new@x.com' }]),
        true,
      );

      expect(sequelizeMock.transaction).not.toHaveBeenCalled();
      expect(clientRequestModel.bulkCreate).not.toHaveBeenCalled();
      expect(jobs.enqueue).not.toHaveBeenCalled();
    });

    it('reports what the daily cap leaves', async () => {
      clientRequestModel.count.mockResolvedValue(120);
      const result = await service.importClients(
        COACH.id,
        dto([{ email: 'new@x.com' }]),
        true,
      );
      expect(result.dailyRemaining).toBe(CLIENT_IMPORT_DAILY_LIMIT - 120);
    });
  });

  describe('import', () => {
    it('creates one invite per new person and queues each email', async () => {
      echoBulkCreate();
      findAllUsers.mockResolvedValue([{ id: 'u-1', email: 'has@x.com' }]);

      const result = await service.importClients(
        COACH.id,
        dto(
          [
            { email: 'none@x.com', firstName: 'Ana', note: 'Knee injury' },
            { email: 'has@x.com' },
          ],
          { message: ' Join me here ', locale: 'en' },
        ),
        false,
      );

      expect(result.dryRun).toBe(false);
      const [rows] = clientRequestModel.bulkCreate.mock.calls[0] as [
        Array<Record<string, unknown>>,
      ];
      expect(rows[0]).toMatchObject({
        fromUserId: COACH.id,
        toUserId: null,
        invitedEmail: 'none@x.com',
        invitedFirstName: 'Ana',
        coachNote: 'Knee injury',
        message: 'Join me here',
        type: ClientRequestType.INSTRUCTOR_TO_CLIENT,
        status: ClientRequestStatus.PENDING,
        emailStatus: ClientInviteEmailStatus.QUEUED,
      });
      expect(typeof rows[0].token).toBe('string');
      // An account is reached by id: no address, no signup token.
      expect(rows[1]).toMatchObject({
        toUserId: 'u-1',
        invitedEmail: null,
        token: null,
      });

      expect(notificationService.notify).toHaveBeenCalledTimes(1);
      expect(notificationService.notify).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'u-1' }),
      );

      expect(jobs.enqueue).toHaveBeenCalledTimes(2);
      expect(jobs.enqueue).toHaveBeenCalledWith(
        'notifications.client_invite_send',
        { requestId: 'req-0', locale: 'en' },
        { jobId: expect.stringMatching(/^client-invite-req-0-\d+$/) },
      );
    });

    it("writes no-account emails in the coach's language unless told otherwise", async () => {
      echoBulkCreate();
      await service.importClients(
        COACH.id,
        dto([{ email: 'none@x.com' }]),
        false,
      );
      expect(jobs.enqueue).toHaveBeenCalledWith(
        'notifications.client_invite_send',
        expect.objectContaining({ locale: 'ro' }),
        expect.anything(),
      );
    });

    it('refuses over the daily cap and writes nothing', async () => {
      clientRequestModel.count.mockResolvedValue(CLIENT_IMPORT_DAILY_LIMIT);

      await expect(
        service.importClients(COACH.id, dto([{ email: 'a@x.com' }]), false),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(clientRequestModel.bulkCreate).not.toHaveBeenCalled();
    });

    it('sends again to people already invited only when asked', async () => {
      echoBulkCreate();
      const existing = {
        id: 'req-old',
        type: ClientRequestType.INSTRUCTOR_TO_CLIENT,
        fromUserId: COACH.id,
        toUserId: null,
        invitedEmail: 'pending@x.com',
        token: 'old-token',
        message: 'Earlier message',
        invitedFirstName: null,
        invitedLastName: null,
        coachNote: 'Older note',
        createdAt: new Date(),
        expiresAt: new Date(),
        update: jest.fn(function (this: Record<string, unknown>, values) {
          Object.assign(this, values);
          return Promise.resolve(this);
        }),
      };
      clientRequestModel.findAll.mockResolvedValue([existing]);

      const skipped = await service.importClients(
        COACH.id,
        dto([{ email: 'pending@x.com' }]),
        false,
      );
      expect(skipped.toSend).toBe(0);
      expect(existing.update).not.toHaveBeenCalled();

      await service.importClients(
        COACH.id,
        dto([{ email: 'pending@x.com', firstName: 'Ana', note: 'New note' }], {
          resendPending: true,
        }),
        false,
      );
      expect(existing.update).toHaveBeenCalledWith(
        expect.objectContaining({
          emailStatus: ClientInviteEmailStatus.QUEUED,
          invitedFirstName: 'Ana',
          // The sheet fills gaps, it does not overwrite.
          coachNote: 'Older note',
          message: 'Earlier message',
        }),
        expect.anything(),
      );
      expect(existing.token).not.toBe('old-token');
      expect(jobs.enqueue).toHaveBeenCalledWith(
        'notifications.client_invite_send',
        expect.objectContaining({ requestId: 'req-old' }),
        expect.anything(),
      );
    });

    it('sends inline in the background when there is no queue', async () => {
      echoBulkCreate();
      jobs.enqueue.mockResolvedValue(null);
      clientRequestModel.findByPk.mockResolvedValue(null);

      await service.importClients(
        COACH.id,
        dto([{ email: 'a@x.com' }, { email: 'b@x.com' }]),
        false,
      );
      await new Promise((resolve) => setImmediate(resolve));

      // The first null hands the rest over: no second enqueue attempt.
      expect(jobs.enqueue).toHaveBeenCalledTimes(1);
      expect(clientRequestModel.findByPk).toHaveBeenCalledWith(
        'req-0',
        expect.anything(),
      );
      expect(clientRequestModel.findByPk).toHaveBeenCalledWith(
        'req-1',
        expect.anything(),
      );
    });
  });

  describe('previewInviteEmail', () => {
    it("renders the coach's own invite in their language unless told otherwise", async () => {
      const preview = await service.previewInviteEmail(COACH.id, {
        message: '  Ne vedem pe MotionHive  ',
        recipientFirstName: ' Ana ',
      });

      expect(preview).toEqual({ subject: 'Subject', html: '<html></html>' });
      expect(
        emailService.previewClientImportInvitationEmail,
      ).toHaveBeenCalledWith({
        recipientFirstName: 'Ana',
        instructorName: 'Dan Ionescu',
        instructorAvatarUrl: null,
        message: 'Ne vedem pe MotionHive',
        locale: 'ro',
      });
    });

    it('refuses anyone who is not a coach', async () => {
      roleService.userHasRole.mockResolvedValueOnce(false);
      await expect(
        service.previewInviteEmail('u-1', {}),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('sendInviteEmail', () => {
    const queuedRequest = (overrides: Record<string, unknown> = {}) => ({
      id: 'req-1',
      status: ClientRequestStatus.PENDING,
      emailStatus: ClientInviteEmailStatus.QUEUED,
      toUserId: null,
      toUser: null,
      invitedEmail: 'ana@x.com',
      invitedFirstName: 'Ana',
      token: 'tok',
      message: null,
      fromUser: { firstName: 'Dan', lastName: 'Ionescu', avatarUrl: null },
      update: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    });

    it('sends the signup link to someone with no account and marks it sent', async () => {
      const request = queuedRequest();
      clientRequestModel.findByPk.mockResolvedValue(request);

      const outcome = await service.sendInviteEmail('req-1', 'ro');

      expect(outcome).toEqual({ status: 'sent' });
      expect(emailService.sendClientImportInvitationEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'ana@x.com',
          recipientFirstName: 'Ana',
          instructorName: 'Dan Ionescu',
          token: 'tok',
          locale: 'ro',
        }),
      );
      expect(request.update).toHaveBeenCalledWith({
        emailStatus: ClientInviteEmailStatus.SENT,
      });
    });

    it('sends someone who signed up since the in-app request, in their language', async () => {
      clientRequestModel.findByPk.mockResolvedValue(
        queuedRequest({
          toUserId: 'u-1',
          toUser: {
            email: 'ana.real@x.com',
            firstName: 'Anastasia',
            language: 'en',
          },
        }),
      );

      await service.sendInviteEmail('req-1', 'ro');

      expect(emailService.sendClientImportInvitationEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'ana.real@x.com',
          recipientFirstName: 'Anastasia',
          token: null,
          locale: 'en',
        }),
      );
    });

    it.each([
      ['already sent', { emailStatus: ClientInviteEmailStatus.SENT }],
      ['accepted', { status: ClientRequestStatus.ACCEPTED }],
      ['cancelled', { status: ClientRequestStatus.CANCELLED }],
    ])('skips an invite that is %s', async (_label, overrides) => {
      clientRequestModel.findByPk.mockResolvedValue(queuedRequest(overrides));

      const outcome = await service.sendInviteEmail('req-1', 'ro');

      expect(outcome.status).toBe('skipped');
      expect(
        emailService.sendClientImportInvitationEmail,
      ).not.toHaveBeenCalled();
    });

    it('returns a failure without marking the row, so the job can retry', async () => {
      const request = queuedRequest();
      clientRequestModel.findByPk.mockResolvedValue(request);
      emailService.sendClientImportInvitationEmail.mockResolvedValue({
        ok: false,
        reason: 'rate limited',
      });

      const outcome = await service.sendInviteEmail('req-1', 'ro');

      expect(outcome).toEqual({ status: 'failed', reason: 'rate limited' });
      expect(request.update).not.toHaveBeenCalled();
    });
  });
});
