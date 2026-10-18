import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/sequelize';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op, QueryTypes } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';

import { apiError, day, toLocale } from '../../common/i18n';
import type { AuthenticatedUser } from '../../common/types/authenticated-request';
import { EmailService } from '../../common/services/email.service';
import { RefreshToken } from '../auth/entities/refresh-token.entity';
import { TokenTypes, type JwtPayload } from '../auth/types/jwt-payload';
import { DeviceToken } from '../notification/entities/device-token.entity';
import { Dispute } from '../payment/entities/dispute.entity';
import { StripeService } from '../payment/services/stripe.service';
import { SearchIndexService } from '../search/search-index.service';
import { User } from '../user/entities/user.entity';
import {
  AccountDeletionErrorCodes,
  CODE_TTL_MINUTES,
  COOLING_OFF_DAYS,
  erasureDate,
  DISPUTE_NEEDS_RESPONSE,
  LIVE_BOOKING_STATUSES,
  LIVE_SUBSCRIPTION_STATUSES,
  MAX_CODE_ATTEMPTS,
  RESTORE_TICKET_TTL,
} from './account-deletion.constants';
import { AccountWindDownService } from './account-wind-down.service';
import {
  AccountDeletion,
  AccountDeletionStatus,
} from './entities/account-deletion.entity';

export type AccountDeletionBlocker = 'OPEN_DISPUTE';

/**
 * What deleting would end, counted before anyone confirms: the screen that
 * explains it is built from this. Coach numbers are all zero for someone
 * who does not coach.
 */
export interface AccountDeletionPreview {
  /** Where the code goes. */
  email: string;
  /** When the data would be erased if confirmed now. */
  scheduledFor: string;
  coolingOffDays: number;
  asMember: {
    subscriptions: number;
    bookings: number;
    coaches: number;
    groups: number;
  };
  asCoach: {
    clients: number;
    subscriptions: number;
    upcomingSessions: number;
    bookedPeople: number;
    groups: number;
    groupMembers: number;
  };
  /** Anything that must be dealt with first. Empty means it can go ahead. */
  blockers: AccountDeletionBlocker[];
}

interface PreviewCounts {
  member_subscriptions: string;
  member_bookings: string;
  member_coaches: string;
  member_groups: string;
  coach_clients: string;
  coach_subscriptions: string;
  coach_sessions: string;
  coach_booked_people: string;
  coach_groups: string;
  coach_group_members: string;
}

/**
 * The life of an account deletion, up to the cooling-off:
 *
 *   preview   what deleting would end, and anything blocking it
 *   sendCode  a 6-digit code to the account's own address
 *   confirm   the code: deactivate now, wind everything down, erase within 30 days
 *   scheduleOnRequest   the same for someone who asked by email, done by support
 *   sign-in   during the cooling-off answers with a ticket instead of
 *             tokens; `restore` with that ticket keeps the account
 *
 * The erasure itself is AccountErasureService, run by the daily sweep.
 */
@Injectable()
export class AccountDeletionService {
  constructor(
    @InjectModel(AccountDeletion)
    private readonly deletionModel: typeof AccountDeletion,
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(RefreshToken)
    private readonly refreshTokenModel: typeof RefreshToken,
    @InjectModel(DeviceToken)
    private readonly deviceTokenModel: typeof DeviceToken,
    @InjectModel(Dispute) private readonly disputeModel: typeof Dispute,
    private readonly windDownService: AccountWindDownService,
    private readonly searchIndexService: SearchIndexService,
    private readonly stripeService: StripeService,
    private readonly emailService: EmailService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly sequelize: Sequelize,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // ── Before confirming ─────────────────────────────────────────────────

  async preview(user: AuthenticatedUser): Promise<AccountDeletionPreview> {
    const [counts] = await this.sequelize.query<PreviewCounts>(PREVIEW_SQL, {
      replacements: {
        id: user.id,
        liveSubs: LIVE_SUBSCRIPTION_STATUSES,
        liveBookings: LIVE_BOOKING_STATUSES,
      },
      type: QueryTypes.SELECT,
    });
    const n = (key: keyof PreviewCounts) => Number(counts?.[key] ?? 0);

    return {
      email: user.email,
      scheduledFor: erasureDate(new Date()).toISOString(),
      coolingOffDays: COOLING_OFF_DAYS,
      asMember: {
        subscriptions: n('member_subscriptions'),
        bookings: n('member_bookings'),
        coaches: n('member_coaches'),
        groups: n('member_groups'),
      },
      asCoach: {
        clients: n('coach_clients'),
        subscriptions: n('coach_subscriptions'),
        upcomingSessions: n('coach_sessions'),
        bookedPeople: n('coach_booked_people'),
        groups: n('coach_groups'),
        groupMembers: n('coach_group_members'),
      },
      blockers: await this.blockers(user.id),
    };
  }

  /** Email a fresh 6-digit code. A second request replaces the first code. */
  async sendCode(user: AuthenticatedUser): Promise<{ sentTo: string }> {
    this.assertOwnerAtTheKeyboard(user);
    await this.assertNothingBlocks(user.id);

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const deletion =
      (await this.deletionModel.findOne({
        where: {
          userId: user.id,
          status: AccountDeletionStatus.PENDING_CODE,
        },
      })) ?? this.deletionModel.build({ userId: user.id });

    // The id keys the hash, so a new row needs one before hashing.
    if (deletion.isNewRecord) await deletion.save();
    await deletion.update({
      codeHash: this.hashCode(deletion.id, code),
      codeExpiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000),
      codeAttempts: 0,
      locale: toLocale(user.language),
    });

    const sent = await this.emailService.sendAccountDeletionCodeEmail(
      user.email,
      user.firstName || null,
      code,
      toLocale(user.language),
    );
    if (!sent) {
      throw new ServiceUnavailableException(apiError('account.codeNotSent'));
    }
    return { sentTo: user.email };
  }

  // ── Confirming ────────────────────────────────────────────────────────

  /**
   * Check the code, then: deactivate the account and sign it out everywhere
   * (one transaction), wind down everything it shares with other people,
   * and email the date it will be erased.
   */
  async confirm(
    user: AuthenticatedUser,
    code: string,
  ): Promise<{ scheduledFor: string }> {
    this.assertOwnerAtTheKeyboard(user);

    const deletion = await this.deletionModel.findOne({
      where: { userId: user.id, status: AccountDeletionStatus.PENDING_CODE },
    });
    if (!deletion?.codeHash || !deletion.codeExpiresAt) {
      throw new BadRequestException(apiError('account.noCodeRequested'));
    }
    if (deletion.codeAttempts >= MAX_CODE_ATTEMPTS) {
      throw new BadRequestException(apiError('account.codeTooManyAttempts'));
    }
    if (deletion.codeExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException(apiError('account.codeExpired'));
    }
    if (!this.codeMatches(deletion.id, code, deletion.codeHash)) {
      const attempts = deletion.codeAttempts + 1;
      await deletion.update({ codeAttempts: attempts });
      throw new BadRequestException(
        apiError(
          attempts >= MAX_CODE_ATTEMPTS
            ? 'account.codeTooManyAttempts'
            : 'account.codeInvalid',
        ),
      );
    }
    await this.assertNothingBlocks(user.id);
    return this.schedule(deletion, user);
  }

  /**
   * The policy's other route: the person emailed us from their sign-in
   * address, and support acts on it. That address stands in for the code,
   * so the admin has to type the one the request came from. From there it
   * is the same as confirming in the app, emails included.
   */
  async scheduleOnRequest(
    userId: string,
    requestEmail: string,
  ): Promise<{ scheduledFor: string }> {
    const user = await this.userModel.findByPk(userId);
    if (!user) throw new NotFoundException(apiError('user.notFound'));
    if (user.email.toLowerCase() !== requestEmail.trim().toLowerCase()) {
      throw new BadRequestException(apiError('account.requestEmailMismatch'));
    }
    const scheduled = await this.deletionModel.findOne({
      where: { userId, status: AccountDeletionStatus.SCHEDULED },
    });
    if (scheduled?.scheduledFor) {
      throw new ConflictException(
        apiError('account.alreadyScheduled', {
          date: day(scheduled.scheduledFor),
        }),
      );
    }
    await this.assertNothingBlocks(userId, 'account.theirOpenDispute');

    // A code the person asked for in the app and never used is superseded.
    const deletion =
      (await this.deletionModel.findOne({
        where: { userId, status: AccountDeletionStatus.PENDING_CODE },
      })) ?? this.deletionModel.build({ userId });
    return this.schedule(deletion, user);
  }

  /** The deletion support should know about: under way, or done. */
  async latestFor(userId: string): Promise<AccountDeletion | null> {
    return this.deletionModel.findOne({
      where: {
        userId,
        status: {
          [Op.in]: [
            AccountDeletionStatus.SCHEDULED,
            AccountDeletionStatus.ERASED,
          ],
        },
      },
      order: [['createdAt', 'DESC']],
    });
  }

  // ── Signing in during the cooling-off ─────────────────────────────────

  /**
   * Called by every sign-in path once the credentials are proven, before any
   * token is issued. A deactivated account with a deletion under way gets a
   * 403 carrying a short ticket, so the app can offer to keep it; any other
   * account passes through untouched.
   */
  async assertSignInAllowed(user: User): Promise<void> {
    if (user.isActive) return;
    const deletion = await this.deletionModel.findOne({
      where: { userId: user.id, status: AccountDeletionStatus.SCHEDULED },
    });
    if (!deletion?.scheduledFor) return;

    const restoreTicket = this.jwtService.sign(
      { sub: user.id, typ: TokenTypes.ACCOUNT_RESTORE },
      { expiresIn: RESTORE_TICKET_TTL },
    );
    throw new ForbiddenException({
      ...apiError('auth.accountScheduledForDeletion', {
        date: day(deletion.scheduledFor),
      }),
      code: AccountDeletionErrorCodes.ScheduledForDeletion,
      restoreTicket,
      scheduledFor: deletion.scheduledFor.toISOString(),
    });
  }

  /**
   * Keep the account: the deletion is cancelled and the person is active
   * again. What the wind-down ended stays ended. Returns the user so the
   * caller can sign them in.
   */
  async restore(ticket: string): Promise<User> {
    const userId = this.verifyRestoreTicket(ticket);

    const deletion = await this.deletionModel.findOne({
      where: { userId, status: AccountDeletionStatus.SCHEDULED },
    });
    if (!deletion) {
      throw new BadRequestException(apiError('account.notScheduled'));
    }

    await this.sequelize.transaction(async (tx) => {
      await deletion.update(
        {
          status: AccountDeletionStatus.CANCELLED,
          cancelledAt: new Date(),
        },
        { transaction: tx },
      );
      await this.userModel.update(
        { isActive: true },
        { where: { id: userId }, transaction: tx },
      );
    });

    const user = await this.userModel.findByPk(userId);
    if (!user) {
      throw new BadRequestException(apiError('account.notScheduled'));
    }

    // Back in search; their groups and sessions were closed and stay so.
    await this.searchIndexService.upsertUser(userId);
    await this.searchIndexService.upsertInstructor(userId);
    await this.emailService.sendAccountDeletionCancelledEmail(
      user.email,
      user.firstName || null,
      toLocale(user.language),
    );
    this.logger.log(
      `Account deletion cancelled by ${userId}`,
      'AccountDeletionService',
    );
    return user;
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /** Support acting as someone may not delete them. */
  private assertOwnerAtTheKeyboard(user: AuthenticatedUser): void {
    if (user.impersonatedBy) {
      throw new ForbiddenException(apiError('account.notYou'));
    }
  }

  /**
   * Deactivate the account and sign it out everywhere (one transaction),
   * wind down everything it shares with other people, and email the date
   * it will be erased. `deletion` may be unsaved.
   */
  private async schedule(
    deletion: AccountDeletion,
    person: Pick<User, 'id' | 'email' | 'firstName' | 'language'>,
  ): Promise<{ scheduledFor: string }> {
    const now = new Date();
    const scheduledFor = erasureDate(now);
    const locale = toLocale(person.language);
    await this.sequelize.transaction(async (tx) => {
      // update() saves only the fields it is given, so a new row would
      // go in without its user: insert it whole first.
      if (deletion.isNewRecord) await deletion.save({ transaction: tx });
      await deletion.update(
        {
          status: AccountDeletionStatus.SCHEDULED,
          requestedAt: now,
          scheduledFor,
          codeHash: null,
          codeExpiresAt: null,
          locale,
        },
        { transaction: tx },
      );
      await this.userModel.update(
        { isActive: false },
        { where: { id: person.id }, transaction: tx },
      );
      // Signed out everywhere: access tokens die on the isActive check,
      // refresh tokens and push devices go here.
      await this.refreshTokenModel.update(
        { revokedAt: now },
        { where: { userId: person.id, revokedAt: null }, transaction: tx },
      );
      await this.deviceTokenModel.update(
        { revokedAt: now },
        { where: { userId: person.id, revokedAt: null }, transaction: tx },
      );
    });
    this.logger.log(
      `Account deletion scheduled for ${person.id} on ${scheduledFor.toISOString()}`,
      'AccountDeletionService',
    );

    // notify-after-commit: the wind-down tells everyone affected.
    if (await this.windDownService.windDown(person.id)) {
      await deletion.update({ woundDownAt: new Date() });
    }
    await this.emailService.sendAccountDeletionScheduledEmail(
      person.email,
      person.firstName || null,
      scheduledFor,
      locale,
    );
    return { scheduledFor: scheduledFor.toISOString() };
  }

  private async assertNothingBlocks(
    userId: string,
    message:
      | 'account.openDispute'
      | 'account.theirOpenDispute' = 'account.openDispute',
  ): Promise<void> {
    const blockers = await this.blockers(userId);
    if (blockers.includes('OPEN_DISPUTE')) {
      throw new ConflictException({
        ...apiError(message),
        code: AccountDeletionErrorCodes.OpenDispute,
      });
    }
  }

  /**
   * A dispute waiting on the coach's evidence blocks: only they can answer
   * it. Our copy only hears about new disputes, so a locally open one is
   * checked with Stripe and corrected when it has moved on; if Stripe
   * cannot be asked, it counts as open.
   */
  private async blockers(userId: string): Promise<AccountDeletionBlocker[]> {
    const open = await this.disputeModel.findAll({
      where: {
        instructorId: userId,
        status: { [Op.in]: DISPUTE_NEEDS_RESPONSE },
      },
    });
    for (const dispute of open) {
      if (!this.stripeService.isConfigured) return ['OPEN_DISPUTE'];
      try {
        const live = await this.stripeService.stripe.disputes.retrieve(
          dispute.stripeDisputeId,
        );
        if (DISPUTE_NEEDS_RESPONSE.includes(live.status)) {
          return ['OPEN_DISPUTE'];
        }
        await dispute.update({ status: live.status });
      } catch (err) {
        this.logger.warn(
          `Could not check dispute ${dispute.stripeDisputeId}: ${err instanceof Error ? err.message : String(err)}`,
          'AccountDeletionService',
        );
        return ['OPEN_DISPUTE'];
      }
    }
    return [];
  }

  /** HMAC with the app secret: a leaked table cannot be brute-forced. */
  private hashCode(deletionId: string, code: string): string {
    const secret = this.configService.get<string>('JWT_SECRET') ?? '';
    return createHmac('sha256', secret)
      .update(`${deletionId}:${code}`)
      .digest('hex');
  }

  private codeMatches(deletionId: string, code: string, hash: string): boolean {
    const given = Buffer.from(this.hashCode(deletionId, code.trim()), 'hex');
    const stored = Buffer.from(hash, 'hex');
    return given.length === stored.length && timingSafeEqual(given, stored);
  }

  private verifyRestoreTicket(ticket: string): string {
    try {
      const payload = this.jwtService.verify<JwtPayload>(ticket);
      if (payload.typ === TokenTypes.ACCOUNT_RESTORE && payload.sub) {
        return payload.sub;
      }
    } catch {
      // Expired or forged: same answer as a wrong type.
    }
    throw new BadRequestException(apiError('account.restoreExpired'));
  }
}

/**
 * Everything the explanation screen counts, in one round trip. Mirrors what
 * AccountWindDownService ends, step for step.
 */
const PREVIEW_SQL = `
  SELECT
    (SELECT COUNT(*) FROM subscription
      WHERE client_id = :id AND status IN (:liveSubs)
        AND cancel_at_period_end = false) AS member_subscriptions,
    (SELECT COUNT(*) FROM session_participant sp
       JOIN session_instance si ON si.id = sp.instance_id
      WHERE sp.user_id = :id AND sp.status IN (:liveBookings)
        AND si.status = 'SCHEDULED' AND si.start_at > NOW()) AS member_bookings,
    (SELECT COUNT(*) FROM instructor_client
      WHERE client_id = :id AND status = 'ACTIVE') AS member_coaches,
    (SELECT COUNT(*) FROM group_member gm
       JOIN "group" g ON g.id = gm.group_id AND g.deleted_at IS NULL
      WHERE gm.user_id = :id AND gm.left_at IS NULL
        AND gm.role <> 'OWNER') AS member_groups,
    (SELECT COUNT(*) FROM instructor_client
      WHERE instructor_id = :id AND status = 'ACTIVE') AS coach_clients,
    (SELECT COUNT(*) FROM subscription
      WHERE instructor_id = :id AND status IN (:liveSubs)
        AND cancel_at_period_end = false) AS coach_subscriptions,
    (SELECT COUNT(*) FROM session_instance
      WHERE instructor_id = :id AND status = 'SCHEDULED'
        AND start_at > NOW()) AS coach_sessions,
    (SELECT COUNT(DISTINCT sp.user_id) FROM session_participant sp
       JOIN session_instance si ON si.id = sp.instance_id
      WHERE si.instructor_id = :id AND si.status = 'SCHEDULED'
        AND si.start_at > NOW() AND sp.status IN (:liveBookings)) AS coach_booked_people,
    (SELECT COUNT(*) FROM group_member gm
       JOIN "group" g ON g.id = gm.group_id AND g.deleted_at IS NULL
      WHERE gm.user_id = :id AND gm.left_at IS NULL
        AND gm.role = 'OWNER') AS coach_groups,
    (SELECT COUNT(DISTINCT m.user_id) FROM group_member m
       JOIN group_member o ON o.group_id = m.group_id
        AND o.user_id = :id AND o.role = 'OWNER' AND o.left_at IS NULL
       JOIN "group" g ON g.id = m.group_id AND g.deleted_at IS NULL
      WHERE m.left_at IS NULL AND m.user_id <> :id) AS coach_group_members
`;
