import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectModel } from '@nestjs/sequelize';
import { randomUUID } from 'crypto';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { OAuth2Client } from 'google-auth-library';
import { Sequelize } from 'sequelize-typescript';
import { Op } from 'sequelize';
import type { Transaction } from 'sequelize';
import { User } from '../user/entities/user.entity';
import type { SocialProvider } from '../user/entities/social-account.entity';
import { UserService } from '../user/user.service';
import type { OAuthProfile } from '../user/user.service';
import { apiError, toLocale } from '../../common/i18n';
import type { Locale } from '../../common/i18n';
import { RefreshToken } from './entities/refresh-token.entity';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { RoleService } from '../role/role.service';
import { TokenTypes } from './types/jwt-payload';
import type { JwtPayload } from './types/jwt-payload';
import { ProfileService } from '../profile/profile.service';
import { CustomerService } from '../payment/services/customer.service';
import { EmailService } from '../../common/services/email.service';
import { CryptoService } from '../../common/services/crypto.service';
import { EmailVerifierService } from '../../common/services/email-verifier.service';
import { AccountDeletionService } from '../account-deletion/account-deletion.service';
import {
  ClientRequest,
  ClientRequestStatus,
} from '../client/entities/client-request.entity';
import { Invitation } from '../invitation/entities/invitation.entity';
import { stripHtml } from '../../common/utils/text.utils';
import { AppleAccountService } from './apple/apple-account.service';
import { AppleIdentityService } from './apple/apple-identity.service';
import type { AppleIdentity } from './apple/apple-identity.service';
import type { AppleAuthDto } from './dto/apple-auth.dto';
import { FacebookIdentityService } from './facebook/facebook-identity.service';
import type { FacebookIdentity } from './facebook/facebook-identity.service';
import type { FacebookAuthDto } from './dto/facebook-auth.dto';

/** The first name an account gets when the provider shared none. */
const PLACEHOLDER_FIRST_NAME = 'User';

/** The name column's size. */
const NAME_MAX_LENGTH = 100;

/**
 * The name a Facebook sign-in gives an account: the given and family names
 * when Facebook shared them, else the full name split at its last space
 * ("Ana Maria Popescu" is Ana Maria + Popescu), else the placeholder.
 */
function facebookName(identity: FacebookIdentity): {
  firstName: string;
  lastName: string;
} {
  if (identity.givenName || identity.familyName) {
    let firstName = PLACEHOLDER_FIRST_NAME;
    if (identity.givenName) {
      firstName = identity.givenName;
    }
    return { firstName, lastName: identity.familyName ?? '' };
  }
  if (identity.name) {
    const words = identity.name.split(/\s+/);
    if (words.length === 1) {
      return { firstName: words[0], lastName: '' };
    }
    const lastName = words[words.length - 1];
    return { firstName: words.slice(0, -1).join(' '), lastName };
  }
  return { firstName: PLACEHOLDER_FIRST_NAME, lastName: '' };
}

type OAuthFound = Awaited<ReturnType<UserService['findOrCreateFromOAuth']>>;

/** Extra writes a provider makes inside the sign-in transaction, after the account is found or made. */
type OAuthInTransaction = (
  found: OAuthFound,
  transaction: Transaction,
) => Promise<void>;

/** Return type of generateTokens; used for typing buildAuthResponse and responses */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

/** User shape returned by login/register (no secrets, with roles) */
export interface AuthUserResponse {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  handle: string | null;
  isEmailVerified: boolean;
  roles: string[];
}

/**
 * Auth Service
 *
 * Handles authentication logic:
 * - User registration
 * - User login with account lockout protection
 * - Password reset flow
 * - JWT token generation
 * - Refresh tokens with DB-backed storage and revocation
 * - Change password with token invalidation
 */
/**
 * How long a rotated refresh token still refreshes, for two requests a moment
 * apart (two tabs, a retry after a lost answer). Later it ends the sign in.
 */
const REFRESH_REUSE_GRACE_MS = 60_000;

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(RefreshToken)
    private readonly refreshTokenModel: typeof RefreshToken,
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly roleService: RoleService,
    private readonly profileService: ProfileService,
    private readonly customerService: CustomerService,
    private readonly configService: ConfigService,
    private readonly sequelize: Sequelize,
    private readonly emailService: EmailService,
    private readonly cryptoService: CryptoService,
    private readonly emailVerifier: EmailVerifierService,
    private readonly accountDeletionService: AccountDeletionService,
    private readonly appleIdentity: AppleIdentityService,
    private readonly appleAccounts: AppleAccountService,
    private readonly facebookIdentity: FacebookIdentityService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Register a new user
   *
   * Deliverability check runs BEFORE the DB transaction — if the email is
   * bogus (disposable host or domain has no MX), we abort cleanly with 400
   * and never touch the DB. OAuth register paths (registerWithGoogle /
   * registerWithFacebook) skip this check because the provider has already
   * proven the email belongs to the user.
   */
  async register(registerDto: RegisterDto) {
    await this.emailVerifier.assertDeliverable(registerDto.email);

    const transaction = await this.sequelize.transaction();

    try {
      const user = await this.userService.create(registerDto, transaction);

      await this.roleService.assignRoleToUserByName(
        user.id,
        'USER',
        undefined,
        undefined,
        transaction,
      );

      if (registerDto.isInstructor) {
        await this.profileService.createInstructorProfileInTransaction(
          user.id,
          registerDto.firstName,
          registerDto.lastName,
          transaction,
        );
      }

      const verificationToken =
        await this.userService.generateEmailVerificationToken(
          user,
          transaction,
        );

      await transaction.commit();

      const tokens = await this.generateAndStoreTokens(user.id, user.email);

      const roles = await this.roleService.getUserRoles(user?.id);
      const roleNames = roles.map((role) => role.name);

      this.logger.log(`User registered: ${user.email}`, 'AuthService');

      this.emailService
        .sendEmailVerification(
          user.email,
          verificationToken,
          toLocale(user.language),
        )
        .catch((err) =>
          this.logger.error(
            `Failed to send verification email: ${err.message}`,
            'AuthService',
          ),
        );

      // Nothing addressed to this email is linked yet: the address is not
      // proven until the link in that email is opened (`verifyEmail`).
      // Linking here let anyone sign up with someone else's address and
      // receive their client invitations and billing records.

      return this.buildAuthResponse(user, tokens, roleNames);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * What was sent to an address before its account existed: client
   * invitations and guest billing records. Only once the address is
   * proven (verified, or vouched for by the sign-in provider).
   */
  private linkAddressedToEmail(userId: string, email: string): void {
    this.linkGuestStripeCustomers(userId, email);
    this.linkPendingInvitations(userId, email).catch((err: Error) =>
      this.logger.error(
        `Failed to link pending invitations: ${err.message}`,
        'AuthService',
      ),
    );
  }

  /**
   * Attach any guest stripe_customer rows that match this user's email
   * (created when an instructor invoiced them by email before they had
   * an account). Idempotent — safe to call on every registration path.
   *
   * Fire-and-forget: if it fails the registration response still goes
   * through. A daily backfill (jobs sprint) catches anything missed
   * here.
   */
  private linkGuestStripeCustomers(userId: string, email: string): void {
    this.customerService
      .linkGuestToUser(userId, email)
      .catch((err: unknown) =>
        this.logger.error(
          `Failed to link guest stripe_customer rows for user ${userId}: ${
            (err as Error).message
          }`,
          'AuthService',
        ),
      );
  }

  /**
   * Login user
   */
  async login(loginDto: LoginDto) {
    const user = await this.userService.findByEmail(loginDto.email);

    if (!user) {
      throw new UnauthorizedException(apiError('auth.invalidCredentials'));
    }

    // The try is taken before the password is compared, so a burst of
    // parallel guesses gets five, not one each before the lock lands.
    const attempt = await this.userService.claimLoginAttempt(user.id);
    if (!attempt.allowed) {
      let minutes = 1;
      if (attempt.lockedUntil) {
        minutes = Math.max(
          1,
          Math.ceil((attempt.lockedUntil.getTime() - Date.now()) / 60_000),
        );
      }
      this.logger.warn(
        `Login attempt on locked account: ${user.id}`,
        'AuthService',
      );
      throw new UnauthorizedException(
        apiError('auth.accountLocked', { minutes }),
      );
    }

    const isPasswordValid = await this.userService.validatePassword(
      user,
      loginDto.password,
    );

    if (!isPasswordValid) {
      this.logger.warn(
        `Failed login attempt for: ${user.id} (${attempt.failedAttempts} attempts)`,
        'AuthService',
      );

      throw new UnauthorizedException(apiError('auth.invalidCredentials'));
    }

    // The right password clears the count before anything else can refuse
    // the sign in: a person in their deletion cooling-off must not lock
    // themselves out by trying again.
    await this.userService.resetFailedAttempts(user);

    // Only now that the password is proven: an account in its deletion
    // cooling-off answers with the offer to keep it instead of tokens.
    // Asking earlier would tell anyone the account is being deleted.
    await this.accountDeletionService.assertSignInAllowed(user);

    await user.update({ lastLoginAt: new Date() });

    const tokens = await this.generateAndStoreTokens(user.id, user.email);

    const roles = await this.roleService.getUserRoles(user?.id);
    const roleNames = roles.map((role) => role.name);

    this.logger.log(`User logged in: ${user.email}`, 'AuthService');

    return this.buildAuthResponse(user, tokens, roleNames);
  }

  /**
   * Change password (authenticated user)
   *
   * Verifies current password, updates to new password,
   * sets passwordChangedAt, and revokes all refresh tokens.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    const user = await this.userService.findById(userId);
    if (!user) {
      throw new UnauthorizedException(apiError('common.unauthorized'));
    }

    if (!user.passwordHash) {
      throw new BadRequestException(apiError('auth.noPasswordToChange'));
    }

    const isValid = await this.userService.validatePassword(
      user,
      dto.currentPassword,
    );
    if (!isValid) {
      throw new UnauthorizedException(
        apiError('auth.currentPasswordIncorrect'),
      );
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException(apiError('auth.samePassword'));
    }

    await this.userService.changePassword(user, dto.newPassword);

    // Revoke all refresh tokens — forces re-login on all devices
    await this.revokeAllUserTokens(userId);

    this.logger.log(`Password changed for user: ${user.email}`, 'AuthService');

    // Security email — fire-and-forget so a transport hiccup doesn't
    // fail the password change itself. The user already sees the
    // success response; the email is reassurance + an out for victims
    // of session hijack.
    this.emailService
      .sendPasswordChangedEmail(
        user.email,
        user.firstName,
        new Date(),
        toLocale(user.language),
        user.timezone,
      )
      .catch((err: Error) =>
        this.logger.error(
          `Failed to send password-changed email to ${user.email}: ${err.message}`,
          'AuthService',
        ),
      );

    return { message: 'Password changed successfully. Please log in again.' };
  }

  private buildAuthResponse(
    user: User,
    tokens: AuthTokens,
    roleNames: string[],
  ): AuthTokens & { user: AuthUserResponse } {
    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        handle: user.handle ?? null,
        isEmailVerified: user.isEmailVerified,
        roles: roleNames,
      },
    };
  }

  /**
   * Link pending client invitations and group invitations to a newly registered user.
   *
   * For client requests: sets toUserId so the user can see and accept them.
   * For group invitations: logs a notice (invitations are matched by email
   * at accept-time, so no DB update needed — they just show up in GET /invitations/pending).
   */
  private async linkPendingInvitations(
    userId: string,
    email: string,
  ): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Link pending client requests
    const [clientCount] = await ClientRequest.update(
      { toUserId: userId },
      {
        where: {
          invitedEmail: normalizedEmail,
          toUserId: null,
          status: ClientRequestStatus.PENDING,
          expiresAt: { [Op.gt]: new Date() },
        },
      },
    );

    // 2. Count pending group invitations (no update needed — matched by email at accept-time)
    const groupInvitationCount = await Invitation.count({
      where: {
        email: normalizedEmail,
        acceptedAt: null,
        declinedAt: null,
        expiresAt: { [Op.gt]: new Date() },
      },
    });

    if (clientCount > 0 || groupInvitationCount > 0) {
      this.logger.log(
        `New user ${email}: ${clientCount} client invitation(s), ${groupInvitationCount} group invitation(s) pending`,
        'AuthService',
      );
    }
  }

  // =====================================================
  // TOKEN MANAGEMENT (DB-backed)
  // =====================================================

  /**
   * Generate access + refresh tokens and store refresh token hash in DB.
   * A sign in starts a family; a rotation passes the family it continues.
   *
   * @Arguments userId, email, opts.id?, opts.familyId?, opts.transaction?
   */
  private async generateAndStoreTokens(
    userId: string,
    email: string,
    opts: { id?: string; familyId?: string; transaction?: Transaction } = {},
  ): Promise<AuthTokens> {
    const payload = { sub: userId, email };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_EXPIRES_IN') || '2h',
    });

    const id = opts.id ?? randomUUID();
    const refreshToken = this.jwtService.sign(
      { ...payload, typ: TokenTypes.REFRESH, jti: id },
      {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
        expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN') || '7d',
      },
    );

    // Store hashed refresh token in DB
    const tokenHash = this.cryptoService.hashToken(refreshToken);
    const refreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d';
    const expiresAt = new Date();
    const days = parseInt(refreshExpiresIn, 10) || 7;
    expiresAt.setDate(expiresAt.getDate() + days);

    let familyId = id;
    if (opts.familyId) {
      familyId = opts.familyId;
    }

    await this.refreshTokenModel.create(
      {
        id,
        userId,
        tokenHash,
        expiresAt,
        familyId,
      },
      { transaction: opts.transaction },
    );

    return { accessToken, refreshToken };
  }

  /**
   * Mint a short-lived ACCESS-ONLY token that acts as `targetUserId`,
   * for admin impersonation ("log in as this user" support tool).
   *
   * Deliberately different from `generateAndStoreTokens`:
   *  - Short TTL (30m) so an impersonation session expires on its own.
   *  - NO refresh token is issued or persisted — an impersonation
   *    session must not be silently renewable into a long-lived one.
   *  - Carries an `act_as` claim (the impersonating admin's id) so the
   *    token is self-describing and `JwtStrategy` can flag the request.
   *
   * The existing `generateAndStoreTokens` and all of its call sites are
   * untouched; this is purely additive. Authorization (only SUPER_ADMIN,
   * never impersonate another admin) is enforced by the caller in
   * `AdminImpersonationService` before this is invoked.
   */
  mintImpersonationToken(
    targetUserId: string,
    targetEmail: string,
    impersonatedByAdminId: string,
  ): { accessToken: string; expiresIn: string } {
    const expiresIn = '30m';
    const payload = {
      sub: targetUserId,
      email: targetEmail,
      act_as: impersonatedByAdminId,
    };

    const accessToken = this.jwtService.sign(payload, { expiresIn });

    return { accessToken, expiresIn };
  }

  /**
   * Refresh access token
   *
   * Validates refresh token against DB (must exist, not expired) and rotates
   * it: the old row is claimed in one update, so two refreshes with the same
   * token never both rotate it. A rotated token that comes back:
   * - within REFRESH_REUSE_GRACE_MS (two tabs, a retried request) gets its
   *   own pair in the same sign in;
   * - later, is a copy someone kept: the whole sign in (family) ends, so a
   *   thief and the person are both signed out and only the password gets
   *   back in. Before, the thief kept rotating and the person was signed out.
   *
   * @Arguments refreshToken
   */
  async refreshAccessToken(refreshToken: string) {
    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify<JwtPayload>(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException(apiError('common.unauthorized'));
    }

    // A refresh token says so (older ones say nothing); a narrower token
    // signed with the same secret is not one.
    if (payload.typ !== undefined && payload.typ !== TokenTypes.REFRESH) {
      throw new UnauthorizedException(apiError('common.unauthorized'));
    }

    const user = await this.userService.findById(payload.sub);
    if (!user || !user.isActive) {
      throw new UnauthorizedException(apiError('common.unauthorized'));
    }

    // Check passwordChangedAt — reject tokens issued before password change
    if (user.passwordChangedAt && payload.iat) {
      const passwordChangedAtSec = Math.floor(
        user.passwordChangedAt.getTime() / 1000,
      );
      if (payload.iat < passwordChangedAtSec) {
        throw new UnauthorizedException(apiError('auth.passwordChanged'));
      }
    }

    // Revoked or not: a rotated token coming back is what gives a copy away.
    const tokenHash = this.cryptoService.hashToken(refreshToken);
    const storedToken = await this.refreshTokenModel.findOne({
      where: {
        userId: user.id,
        tokenHash,
      },
    });

    if (!storedToken) {
      throw new UnauthorizedException(apiError('common.unauthorized'));
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException(apiError('common.unauthorized'));
    }

    let familyId = storedToken.id;
    if (storedToken.familyId) {
      familyId = storedToken.familyId;
    }

    if (storedToken.revokedAt === null) {
      const rotated = await this.rotateRefreshToken(
        storedToken.id,
        familyId,
        user,
      );
      if (rotated) {
        return rotated;
      }
      // Another request rotated it a moment ago: read what it left.
      await storedToken.reload();
    }

    const revokedAt = storedToken.revokedAt;
    const wasRotated = storedToken.replacedById !== null;
    let withinGrace = false;
    if (wasRotated && revokedAt) {
      withinGrace = Date.now() - revokedAt.getTime() <= REFRESH_REUSE_GRACE_MS;
    }
    if (withinGrace) {
      // Only while the sign in is still live: signing out (here or
      // everywhere) or a new password a moment after a rotation revoked
      // its successor, and the old token must not undo that.
      const live = await this.refreshTokenModel.count({
        where: { familyId, revokedAt: null },
      });
      withinGrace = live > 0;
    }

    if (withinGrace) {
      const tokens = await this.generateAndStoreTokens(user.id, user.email, {
        familyId,
      });
      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
    }

    if (wasRotated) {
      await this.refreshTokenModel.update(
        { revokedAt: new Date() },
        { where: { familyId, revokedAt: null } },
      );
      this.logger.warn(
        `Refresh token reused after rotation: sign in ${familyId} of user ${user.id} ended`,
        'AuthService',
      );
    }

    throw new UnauthorizedException(apiError('common.unauthorized'));
  }

  /**
   * Rotate a live refresh token: claim it (revoke and name its successor)
   * and store the successor, in one transaction. Null when another request
   * claimed it first.
   *
   * @Arguments tokenId, familyId, user
   */
  private async rotateRefreshToken(
    tokenId: string,
    familyId: string,
    user: User,
  ): Promise<AuthTokens | null> {
    const nextId = randomUUID();
    return this.sequelize.transaction(async (transaction) => {
      const [claimed] = await this.refreshTokenModel.update(
        { revokedAt: new Date(), replacedById: nextId },
        { where: { id: tokenId, revokedAt: null }, transaction },
      );
      if (claimed === 0) {
        return null;
      }
      const tokens = await this.generateAndStoreTokens(user.id, user.email, {
        id: nextId,
        familyId,
        transaction,
      });
      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
      };
    });
  }

  /**
   * Logout user — revoke the specific refresh token
   */
  async logout(
    refreshToken: string,
    userId: string,
  ): Promise<{ message: string }> {
    try {
      const tokenHash = this.cryptoService.hashToken(refreshToken);

      await this.refreshTokenModel.update(
        { revokedAt: new Date() },
        {
          where: {
            userId,
            tokenHash,
            revokedAt: null,
          },
        },
      );
    } catch {
      // Even if token is invalid, consider logout successful
    }

    this.logger.log(`User logged out: ${userId}`, 'AuthService');
    return { message: 'Logged out successfully' };
  }

  /**
   * Logout from all devices — revoke all refresh tokens for user
   */
  async logoutAll(userId: string): Promise<{ message: string }> {
    await this.revokeAllUserTokens(userId);

    this.logger.log(`All sessions revoked for user: ${userId}`, 'AuthService');

    return { message: 'Logged out from all devices' };
  }

  /**
   * Revoke all refresh tokens for a user
   */
  private async revokeAllUserTokens(userId: string): Promise<void> {
    await this.refreshTokenModel.update(
      { revokedAt: new Date() },
      {
        where: {
          userId,
          revokedAt: null,
        },
      },
    );
  }

  // =====================================================
  // PASSWORD RESET
  // =====================================================

  /**
   * Forgot password - Send reset email
   */
  async forgotPassword(forgotPasswordDto: ForgotPasswordDto) {
    const user = await this.userService.findByEmail(forgotPasswordDto.email);

    if (user) {
      const resetToken =
        await this.userService.generatePasswordResetToken(user);

      await this.emailService.sendPasswordResetEmail(
        user.email,
        resetToken,
        toLocale(user.language),
      );

      this.logger.log(
        `Password reset requested for ${user.email}`,
        'AuthService',
      );

      // The link goes only by email. It was also returned here whenever
      // NODE_ENV was not "production", its default, so on any server left
      // on the default anyone could reset any account with one request.
    }

    return {
      message:
        'If your email is registered, you will receive a password reset link.',
    };
  }

  /**
   * Reset password with token
   */
  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    const user = await this.userService.findByPasswordResetToken(
      resetPasswordDto.token,
    );

    if (!user) {
      throw new BadRequestException(apiError('auth.resetLinkInvalid'));
    }

    await this.userService.resetPassword(user, resetPasswordDto.newPassword);

    // Revoke all refresh tokens after password reset
    await this.revokeAllUserTokens(user.id);

    this.logger.log(`Password reset for user: ${user.email}`, 'AuthService');

    return {
      message: 'Password successfully reset. You can now log in.',
    };
  }

  // =====================================================
  // EMAIL VERIFICATION
  // =====================================================

  async verifyEmail(verifyEmailDto: VerifyEmailDto) {
    const user = await this.userService.findByEmailVerificationToken(
      verifyEmailDto.token,
    );

    if (!user) {
      throw new BadRequestException(apiError('auth.verificationLinkInvalid'));
    }

    if (user.isEmailVerified) {
      return { message: 'Email is already verified.' };
    }

    await this.userService.markEmailVerified(user);

    this.logger.log(`Email verified for user: ${user.email}`, 'AuthService');

    // The address is theirs now: what was sent to it before they signed
    // up joins the account.
    this.linkAddressedToEmail(user.id, user.email);

    this.emailService
      .sendWelcomeEmail(user.email, user.firstName, toLocale(user.language))
      .catch((err) =>
        this.logger.error(
          `Failed to send welcome email: ${err.message}`,
          'AuthService',
        ),
      );

    return {
      message: 'Email verified successfully. You can now use all features.',
    };
  }

  /**
   * GET /auth/verify-email landing-page renderer. Wraps the JSON
   * `verifyEmail()` flow with a tiny HTML response so the link in the
   * verification email can land in a browser without the FE having
   * to mount a `/verify-email` route. Returns the HTML + status code
   * the controller should reply with — keeps presentation out of the
   * controller.
   */
  async verifyEmailHtml(
    token: string,
  ): Promise<{ status: number; html: string }> {
    const successHtml = `<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#fef3c7;"><div style="text-align:center;padding:40px;background:white;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);"><h1 style="color:#f59e0b;">Email Verified!</h1><p>Your email has been verified successfully. You can close this page.</p></div></body></html>`;
    const errorHtml = `<html><body style="font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#fef2f2;"><div style="text-align:center;padding:40px;background:white;border-radius:12px;box-shadow:0 4px 12px rgba(0,0,0,0.1);"><h1 style="color:#ef4444;">Verification Failed</h1><p>This link is invalid or has expired. Please request a new verification email.</p></div></body></html>`;
    try {
      await this.verifyEmail({ token });
      return { status: 200, html: successHtml };
    } catch {
      return { status: 400, html: errorHtml };
    }
  }

  async resendVerification(resendVerificationDto: ResendVerificationDto) {
    const user = await this.userService.findByEmail(
      resendVerificationDto.email,
    );

    if (user && !user.isEmailVerified) {
      const verificationToken =
        await this.userService.generateEmailVerificationToken(user);

      await this.emailService.sendEmailVerification(
        user.email,
        verificationToken,
        toLocale(user.language),
      );

      this.logger.log(
        `Verification email resent to: ${user.email}`,
        'AuthService',
      );
    }

    return {
      message:
        'If your email is registered and not yet verified, a new verification link has been sent.',
    };
  }

  // =====================================================
  // OAUTH
  // =====================================================

  async registerWithGoogle(idToken: string, language?: Locale) {
    const clientId = this.configService.get<string>('GOOGLE_CLIENT_ID');
    if (!clientId) {
      throw new BadRequestException(
        apiError('auth.providerUnavailable', { provider: 'Google' }),
      );
    }

    // The iOS app's sign-in mints tokens for its own client; Android's and the
    // web's carry the web client ID.
    const iosClientId = this.configService.get<string>('GOOGLE_IOS_CLIENT_ID');
    const audience = iosClientId ? [clientId, iosClientId] : clientId;

    const client = new OAuth2Client(clientId);
    let payload: {
      sub: string;
      email?: string;
      email_verified?: boolean;
      given_name?: string;
      family_name?: string;
    } | null;
    try {
      const ticket = await client.verifyIdToken({
        idToken,
        audience,
      });
      payload = ticket.getPayload() ?? null;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(
        `Google ID token verification failed: ${message}`,
        'AuthService',
      );
      throw new UnauthorizedException(
        apiError('auth.providerSignInFailed', { provider: 'Google' }),
      );
    }

    if (!payload?.sub) {
      throw new UnauthorizedException(
        apiError('auth.providerSignInFailed', { provider: 'Google' }),
      );
    }

    const email = payload.email?.trim();
    if (!email) {
      throw new BadRequestException(
        apiError('auth.providerNoEmail', { provider: 'Google' }),
      );
    }

    const profile = {
      providerUserId: payload.sub,
      email,
      emailVerified: payload.email_verified === true,
      firstName: payload.given_name?.trim() || PLACEHOLDER_FIRST_NAME,
      lastName: payload.family_name?.trim() || '',
      language,
    };

    return this.handleOAuthSignIn('GOOGLE', profile);
  }

  /**
   * Sign in with Facebook, with one of two tokens:
   * - `accessToken` (web, Android): a Graph access token, checked with
   *   `debug_token` (valid, and minted for our app) and read with `/me`.
   * - `idToken` + `rawNonce` (iPhone): a Limited Login ID token, checked
   *   against Meta's keys; Graph refuses these tokens.
   *
   * Both name the person by their app-scoped id, so one person has one
   * account on every device. Facebook does not say whether it checked the
   * address, so a Facebook sign-in never joins an existing account by email.
   */
  async registerWithFacebook(dto: FacebookAuthDto) {
    const { accessToken, idToken, rawNonce } = dto;
    let identity: FacebookIdentity;
    if (idToken) {
      if (accessToken || !rawNonce) {
        throw new BadRequestException(apiError('auth.facebookTokenChoice'));
      }
      if (!this.facebookIdentity.canCheckIdTokens) {
        throw new BadRequestException(
          apiError('auth.providerUnavailable', { provider: 'Facebook' }),
        );
      }
      identity = await this.checkFacebookToken('ID token', () =>
        this.facebookIdentity.verifyIdToken(idToken, rawNonce),
      );
    } else if (accessToken) {
      if (rawNonce) {
        throw new BadRequestException(apiError('auth.facebookTokenChoice'));
      }
      if (!this.facebookIdentity.canCheckAccessTokens) {
        throw new BadRequestException(
          apiError('auth.providerUnavailable', { provider: 'Facebook' }),
        );
      }
      identity = await this.checkFacebookToken('access token', () =>
        this.facebookIdentity.verifyAccessToken(accessToken),
      );
    } else {
      throw new BadRequestException(apiError('auth.facebookTokenChoice'));
    }

    if (!identity.email) {
      throw new BadRequestException(
        apiError('auth.providerNoEmail', { provider: 'Facebook' }),
      );
    }

    const { firstName, lastName } = facebookName(identity);
    const profile: OAuthProfile = {
      providerUserId: identity.id,
      email: identity.email,
      // Facebook does not say whether it checked the address, so a
      // Facebook sign-in never joins an existing account by email.
      emailVerified: false,
      firstName,
      lastName,
      language: dto.language,
    };

    return this.handleOAuthSignIn('FACEBOOK', profile);
  }

  /**
   * Run one of Facebook's token checks. Any failure is logged with its
   * reason (never the token) and answered with the same refusal, so a
   * caller cannot learn which check failed.
   */
  private async checkFacebookToken(
    kind: string,
    check: () => Promise<FacebookIdentity>,
  ): Promise<FacebookIdentity> {
    try {
      return await check();
    } catch (err) {
      let message = 'unknown';
      if (err instanceof Error) {
        message = err.message;
      }
      this.logger.warn(`Facebook ${kind} rejected: ${message}`, 'AuthService');
      throw new UnauthorizedException(
        apiError('auth.providerSignInFailed', { provider: 'Facebook' }),
      );
    }
  }

  /**
   * Sign in with Apple, from the iPhone app or the web app's popup.
   *
   * Order, as for Stripe: check the identity token, then trade the code for
   * a refresh token over HTTP outside any transaction, then sign in inside
   * one and store what Apple gave. A failed trade never blocks the sign-in;
   * there is just no grant to revoke until the next Apple sign-in stores one.
   *
   * The name: Apple shares it only on the first authorization, and only
   * with the app (never in the token), so the client forwards it. It names
   * a new account, or fills in one still on the placeholder because an
   * earlier attempt failed after Apple shared it. Otherwise a name someone
   * set in MotionHive is never overwritten.
   */
  async registerWithApple(dto: AppleAuthDto) {
    if (!this.appleIdentity.isAvailable) {
      throw new BadRequestException(
        apiError('auth.providerUnavailable', { provider: 'Apple' }),
      );
    }

    let identity: AppleIdentity;
    try {
      identity = await this.appleIdentity.verifyIdentityToken(
        dto.identityToken,
        dto.rawNonce,
      );
    } catch (err) {
      let message = 'unknown';
      if (err instanceof Error) {
        message = err.message;
      }
      this.logger.warn(
        `Apple identity token rejected: ${message}`,
        'AuthService',
      );
      throw new UnauthorizedException(
        apiError('auth.providerSignInFailed', { provider: 'Apple' }),
      );
    }

    if (!identity.email) {
      throw new BadRequestException(
        apiError('auth.providerNoEmail', { provider: 'Apple' }),
      );
    }

    let refreshToken: string | null = null;
    if (dto.authorizationCode) {
      const exchange = await this.appleIdentity.exchangeCode(
        dto.authorizationCode,
        identity,
      );
      if (exchange.status === 'ok') {
        refreshToken = exchange.refreshToken;
      } else {
        this.logger.warn(
          `Apple code not exchanged (${exchange.status}): ${exchange.reason}`,
          'AuthService',
        );
      }
    }

    const firstName = stripHtml(dto.firstName, NAME_MAX_LENGTH);
    const lastName = stripHtml(dto.lastName, NAME_MAX_LENGTH);
    let profileFirstName = firstName;
    if (!profileFirstName) {
      profileFirstName = PLACEHOLDER_FIRST_NAME;
    }

    const profile: OAuthProfile = {
      providerUserId: identity.sub,
      email: identity.email,
      emailVerified: identity.emailVerified,
      firstName: profileFirstName,
      lastName,
      language: dto.language,
    };

    return this.handleOAuthSignIn('APPLE', profile, async (found, tx) => {
      if (
        !found.isNewUser &&
        firstName &&
        this.hasPlaceholderName(found.user)
      ) {
        found.user = await this.userService.updateUser(
          found.user.id,
          { firstName, lastName },
          tx,
        );
      }
      await this.appleAccounts.recordSignIn(identity, refreshToken, tx);
    });
  }

  /** Still named as a provider that shared no name left it. */
  private hasPlaceholderName(user: User): boolean {
    return user.firstName === PLACEHOLDER_FIRST_NAME && !user.lastName;
  }

  /**
   * Shared OAuth flow: find or create user, assign role/profile if new, return JWT + user.
   *
   * Security: If an existing email/password user is found and no social account link exists,
   * we require the user to link their account explicitly (prevents OAuth account takeover).
   */
  private async handleOAuthSignIn(
    provider: SocialProvider,
    profile: OAuthProfile,
    inTransaction?: OAuthInTransaction,
  ) {
    const transaction = await this.sequelize.transaction();
    let found: OAuthFound;
    try {
      found = await this.userService.findOrCreateFromOAuth(
        provider,
        profile,
        transaction,
      );

      if (found.isNewUser) {
        await this.roleService.assignRoleToUserByName(
          found.user.id,
          'USER',
          undefined,
          undefined,
          transaction,
        );
      }

      if (inTransaction) {
        await inTransaction(found, transaction);
      }

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    // Everything below runs after the commit, outside the try: a throw here
    // must not try to roll back a finished transaction.
    const { user, isNewUser } = found;

    // The provider vouched for them: an account in its deletion cooling-off
    // answers with the offer to keep it instead of tokens.
    if (!isNewUser) {
      await this.accountDeletionService.assertSignInAllowed(user);
    }

    // Link any pre-existing guest stripe_customer rows. Only on the
    // new-user path — existing users have either already been linked
    // at first signup OR are covered by the one-time backfill.
    // Only when the provider vouched for the address (Google's and
    // Apple's `email_verified`; Facebook never does). A relay address
    // matches none, which is fine: client invite links work by their token.
    if (isNewUser && user.isEmailVerified) {
      this.linkAddressedToEmail(user.id, user.email);
    }

    const tokens = await this.generateAndStoreTokens(user.id, user.email);
    const roles = await this.roleService.getUserRoles(user.id);
    const roleNames = roles.map((r) => r.name);

    this.logger.log(
      `User signed in with ${provider}: ${user.email}`,
      'AuthService',
    );

    return {
      ...tokens,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isEmailVerified: user.isEmailVerified,
        roles: roleNames,
      },
    };
  }

  /**
   * Keep an account scheduled for deletion and sign it in, given the ticket
   * a sign-in answered with during the cooling-off.
   */
  async restoreAccount(ticket: string) {
    const user = await this.accountDeletionService.restore(ticket);
    await user.update({ lastLoginAt: new Date() });

    const tokens = await this.generateAndStoreTokens(user.id, user.email);
    const roles = await this.roleService.getUserRoles(user.id);
    const roleNames = roles.map((role) => role.name);

    this.logger.log(`Account kept and signed in: ${user.email}`, 'AuthService');
    return this.buildAuthResponse(user, tokens, roleNames);
  }
}
