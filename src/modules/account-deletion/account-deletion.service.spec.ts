import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import type { AuthenticatedUser } from '../../common/types/authenticated-request';
import { TokenTypes, type JwtPayload } from '../auth/types/jwt-payload';
import type { User } from '../user/entities/user.entity';
import { makeSilentLogger } from '../../../test/helpers/sequelize-mocks';
import { erasureDate } from './account-deletion.constants';
import { AccountDeletionService } from './account-deletion.service';
import {
  AccountDeletionStatus,
  type AccountDeletion,
} from './entities/account-deletion.entity';

/**
 * The guard rails on the one action that cannot be taken back. Smoke-level,
 * not exhaustive: every path that must refuse refuses, and the happy path
 * deactivates, signs out and winds down in the right order.
 */
describe('AccountDeletionService', () => {
  const SECRET = 'test-secret';
  const jwtService = new JwtService({ secret: SECRET });
  const configService = {
    get: (key: string) => (key === 'JWT_SECRET' ? SECRET : undefined),
  } as unknown as ConfigService;

  const tx = {};
  let row: Record<string, unknown> & { update: jest.Mock };
  const deletionModel = { findOne: jest.fn(), build: jest.fn() };
  const userModel = { update: jest.fn(), findByPk: jest.fn() };
  const refreshTokenModel = { update: jest.fn() };
  const deviceTokenModel = { update: jest.fn() };
  const disputeModel = { findAll: jest.fn() };
  const windDownService = { windDown: jest.fn() };
  const searchIndexService = {
    upsertUser: jest.fn(),
    upsertInstructor: jest.fn(),
  };
  const stripeService = { isConfigured: false };
  const emailService = {
    sendAccountDeletionCodeEmail: jest.fn(),
    sendAccountDeletionScheduledEmail: jest.fn(),
    sendAccountDeletionCancelledEmail: jest.fn(),
  };
  const sequelize = {
    transaction: jest.fn((cb: (t: unknown) => unknown) => cb(tx)),
    query: jest.fn(),
  };

  const ana = {
    id: 'user-1',
    email: 'ana@example.com',
    firstName: 'Ana',
    language: 'ro',
  } as unknown as AuthenticatedUser;

  let service: AccountDeletionService;

  type FakeRow = Record<string, unknown> & { update: jest.Mock };

  /** A deletion row whose `update` writes onto itself, like a model would. */
  function makeRow(fields: Record<string, unknown> = {}): FakeRow {
    const r: FakeRow = {
      id: 'deletion-1',
      isNewRecord: false,
      status: AccountDeletionStatus.PENDING_CODE,
      codeAttempts: 0,
      save: jest.fn(),
      ...fields,
      update: jest.fn(),
    };
    r.update.mockImplementation((patch: Record<string, unknown>) => {
      Object.assign(r, patch);
      return Promise.resolve(r);
    });
    return r;
  }

  /** Send a code through the service and hand back what was emailed. */
  async function sendRealCode(): Promise<string> {
    emailService.sendAccountDeletionCodeEmail.mockResolvedValueOnce(true);
    await service.sendCode(ana);
    return emailService.sendAccountDeletionCodeEmail.mock.calls.at(
      -1,
    )![2] as string;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    row = makeRow();
    deletionModel.findOne.mockResolvedValue(row);
    disputeModel.findAll.mockResolvedValue([]);
    windDownService.windDown.mockResolvedValue(true);
    service = new AccountDeletionService(
      deletionModel as never,
      userModel as never,
      refreshTokenModel as never,
      deviceTokenModel as never,
      disputeModel as never,
      windDownService as never,
      searchIndexService as never,
      stripeService as never,
      emailService as never,
      jwtService,
      configService,
      sequelize as never,
      makeSilentLogger(),
    );
  });

  describe('the code', () => {
    it('is six digits, emailed to the account, and stored only as a hash', async () => {
      const code = await sendRealCode();

      expect(code).toMatch(/^\d{6}$/);
      expect(emailService.sendAccountDeletionCodeEmail).toHaveBeenCalledWith(
        'ana@example.com',
        'Ana',
        code,
        'ro',
      );
      expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.codeHash).not.toContain(code);
    });

    it('is refused to support staff acting as someone', async () => {
      await expect(
        service.sendCode({ ...ana, impersonatedBy: 'admin-1' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(emailService.sendAccountDeletionCodeEmail).not.toHaveBeenCalled();
    });

    it('says so when the email could not be sent', async () => {
      emailService.sendAccountDeletionCodeEmail.mockResolvedValueOnce(false);
      await expect(service.sendCode(ana)).rejects.toThrow(/couldn't send/i);
    });

    it('is not sent while a dispute waits on the coach', async () => {
      // Stripe unreachable here, so a locally open dispute counts as open.
      disputeModel.findAll.mockResolvedValue([
        { stripeDisputeId: 'dp_1', status: 'needs_response' },
      ]);
      await expect(service.sendCode(ana)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });

  describe('confirming', () => {
    it('deactivates, signs out everywhere, winds down and schedules erasure within 30 days', async () => {
      const code = await sendRealCode();
      const before = Date.now();

      const { scheduledFor } = await service.confirm(ana, code);

      const days = (Date.parse(scheduledFor) - before) / 86_400_000;
      expect(days).toBeGreaterThanOrEqual(29);
      expect(days).toBeLessThanOrEqual(30);
      expect(row.status).toBe(AccountDeletionStatus.SCHEDULED);
      expect(row.codeHash).toBeNull();
      expect(userModel.update).toHaveBeenCalledWith(
        { isActive: false },
        { where: { id: 'user-1' }, transaction: tx },
      );
      expect(refreshTokenModel.update).toHaveBeenCalled();
      expect(deviceTokenModel.update).toHaveBeenCalled();
      expect(windDownService.windDown).toHaveBeenCalledWith('user-1');
      expect(row.woundDownAt).toBeInstanceOf(Date);
      expect(emailService.sendAccountDeletionScheduledEmail).toHaveBeenCalled();
    });

    it('refuses a wrong code and counts the try', async () => {
      const code = await sendRealCode();
      const wrong = code === '000000' ? '111111' : '000000';

      await expect(service.confirm(ana, wrong)).rejects.toThrow(/isn't right/i);
      expect(row.codeAttempts).toBe(1);
      expect(userModel.update).not.toHaveBeenCalled();
    });

    it('stops after five wrong codes, even for the right one', async () => {
      const code = await sendRealCode();
      row.codeAttempts = 5;

      await expect(service.confirm(ana, code)).rejects.toThrow(/too many/i);
      expect(userModel.update).not.toHaveBeenCalled();
    });

    it('refuses an expired code', async () => {
      const code = await sendRealCode();
      row.codeExpiresAt = new Date(Date.now() - 1000);

      await expect(service.confirm(ana, code)).rejects.toThrow(/expired/i);
    });

    it('needs a code to have been asked for', async () => {
      deletionModel.findOne.mockResolvedValue(null);
      await expect(service.confirm(ana, '123456')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('a request emailed to support', () => {
    beforeEach(() => userModel.findByPk.mockResolvedValue(ana));

    it('schedules it like confirming in the app, without a code', async () => {
      // Nothing scheduled yet; the unused code from the app is superseded.
      deletionModel.findOne.mockResolvedValueOnce(null);

      const { scheduledFor } = await service.scheduleOnRequest(
        'user-1',
        ' Ana@Example.com ',
      );

      expect(Date.parse(scheduledFor)).toBeGreaterThan(Date.now());
      expect(row.status).toBe(AccountDeletionStatus.SCHEDULED);
      expect(row.locale).toBe('ro');
      expect(userModel.update).toHaveBeenCalledWith(
        { isActive: false },
        { where: { id: 'user-1' }, transaction: tx },
      );
      expect(windDownService.windDown).toHaveBeenCalledWith('user-1');
      expect(
        emailService.sendAccountDeletionScheduledEmail,
      ).toHaveBeenCalledWith('ana@example.com', 'Ana', expect.any(Date), 'ro');
    });

    it('inserts a new deletion whole before scheduling it', async () => {
      // No code was ever asked for in the app: nothing to reuse.
      deletionModel.findOne.mockResolvedValue(null);
      const fresh = makeRow({ isNewRecord: true, userId: 'user-1' });
      deletionModel.build.mockReturnValue(fresh);

      await service.scheduleOnRequest('user-1', 'ana@example.com');

      expect(deletionModel.build).toHaveBeenCalledWith({ userId: 'user-1' });
      expect(fresh.save).toHaveBeenCalledWith({ transaction: tx });
      expect(
        (fresh.save as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan(fresh.update.mock.invocationCallOrder[0]);
      expect(fresh.status).toBe(AccountDeletionStatus.SCHEDULED);
    });

    it('refuses an address that is not the sign-in email', async () => {
      await expect(
        service.scheduleOnRequest('user-1', 'someone@else.com'),
      ).rejects.toThrow(/sign-in email/i);
      expect(userModel.update).not.toHaveBeenCalled();
    });

    it('refuses an account already scheduled, saying when', async () => {
      deletionModel.findOne.mockResolvedValueOnce(
        makeRow({
          status: AccountDeletionStatus.SCHEDULED,
          scheduledFor: new Date('2026-11-17T04:40:00Z'),
        }),
      );
      await expect(
        service.scheduleOnRequest('user-1', 'ana@example.com'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(userModel.update).not.toHaveBeenCalled();
    });

    it('answers not found for an unknown account', async () => {
      userModel.findByPk.mockResolvedValue(null);
      await expect(
        service.scheduleOnRequest('nobody', 'ana@example.com'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('signing in during the cooling-off', () => {
    const scheduled = () =>
      makeRow({
        status: AccountDeletionStatus.SCHEDULED,
        scheduledFor: new Date('2026-11-14T10:00:00Z'),
      }) as unknown as AccountDeletion;

    it('lets an active account through without looking', async () => {
      await service.assertSignInAllowed({
        id: 'user-1',
        isActive: true,
      } as User);
      expect(deletionModel.findOne).not.toHaveBeenCalled();
    });

    it('answers with the offer to keep the account, and a ticket for nothing else', async () => {
      deletionModel.findOne.mockResolvedValue(scheduled());

      const error = await service
        .assertSignInAllowed({ id: 'user-1', isActive: false } as User)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ForbiddenException);
      const body = (error as ForbiddenException).getResponse() as {
        code: string;
        restoreTicket: string;
        scheduledFor: string;
      };
      expect(body.code).toBe('ACCOUNT_SCHEDULED_FOR_DELETION');
      expect(body.scheduledFor).toBe('2026-11-14T10:00:00.000Z');
      const ticket = jwtService.verify<JwtPayload>(body.restoreTicket);
      expect(ticket.typ).toBe(TokenTypes.ACCOUNT_RESTORE);
      expect(ticket.sub).toBe('user-1');
    });

    it('keeps the account with a valid ticket', async () => {
      const deletion = scheduled();
      deletionModel.findOne.mockResolvedValue(deletion);
      userModel.findByPk.mockResolvedValue({
        id: 'user-1',
        email: 'ana@example.com',
        firstName: 'Ana',
        language: 'ro',
      });
      const ticket = jwtService.sign({
        sub: 'user-1',
        typ: TokenTypes.ACCOUNT_RESTORE,
      });

      await service.restore(ticket);

      expect(deletion.status).toBe(AccountDeletionStatus.CANCELLED);
      expect(userModel.update).toHaveBeenCalledWith(
        { isActive: true },
        { where: { id: 'user-1' }, transaction: tx },
      );
      expect(searchIndexService.upsertUser).toHaveBeenCalledWith('user-1');
      expect(emailService.sendAccountDeletionCancelledEmail).toHaveBeenCalled();
    });

    it('refuses a normal access token posing as a ticket', async () => {
      const accessToken = jwtService.sign({ sub: 'user-1' });
      await expect(service.restore(accessToken)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(userModel.update).not.toHaveBeenCalled();
    });
  });

  describe('the erasure date', () => {
    // The sweep runs daily at 04:40 UTC; the date we give is that run.
    it('is the first 04:40 UTC run at least 29 days later', () => {
      expect(erasureDate(new Date('2026-10-15T10:00:00Z')).toISOString()).toBe(
        '2026-11-14T04:40:00.000Z',
      );
      expect(erasureDate(new Date('2026-10-15T03:00:00Z')).toISOString()).toBe(
        '2026-11-13T04:40:00.000Z',
      );
    });

    it('always falls within the 30 days the policy promises', () => {
      for (let hour = 0; hour < 24; hour++) {
        const from = new Date(Date.UTC(2026, 9, 15, hour, 7));
        const days =
          (erasureDate(from).getTime() - from.getTime()) / 86_400_000;
        expect(days).toBeGreaterThanOrEqual(29);
        expect(days).toBeLessThanOrEqual(30);
      }
    });
  });
});
