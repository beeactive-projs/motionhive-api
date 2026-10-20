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
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { OAuth2Client } from 'google-auth-library';
import { Sequelize } from 'sequelize-typescript';
import { Op } from 'sequelize';
import { User } from '../user/entities/user.entity';
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

      this.linkPendingInvitations(user.id, user.email).catch((err) =>
        this.logger.error(
          `Failed to link pending invitations: ${err.message}`,
          'AuthService',
        ),
      );

      this.linkGuestStripeCustomers(user.id, user.email);

      return this.buildAuthResponse(user, tokens, roleNames);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
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

    if (this.userService.isAccountLocked(user)) {
      const minutes = Math.max(
        1,
        Math.ceil((user.lockedUntil!.getTime() - Date.now()) / 60_000),
      );
      this.logger.warn(
        `Login attempt on locked account: ${user.email}`,
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
      await this.userService.incrementFailedAttempts(user);

      this.logger.warn(
        `Failed login attempt for: ${user.email} (${user.failedLoginAttempts + 1} attempts)`,
        'AuthService',
      );

      throw new UnauthorizedException(apiError('auth.invalidCredentials'));
    }

    // Only now that the password is proven: an account in its deletion
    // cooling-off answers with the offer to keep it instead of tokens.
    // Asking earlier would tell anyone the account is being deleted.
    await this.accountDeletionService.assertSignInAllowed(user);

    await this.userService.resetFailedAttempts(user);
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
   * Generate access + refresh tokens and store refresh token hash in DB
   */
  private async generateAndStoreTokens(
    userId: string,
    email: string,
  ): Promise<AuthTokens> {
    const payload = { sub: userId, email };

    const accessToken = this.jwtService.sign(payload, {
      expiresIn: this.configService.get('JWT_EXPIRES_IN') || '2h',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: this.configService.get('JWT_REFRESH_SECRET'),
      expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN') || '7d',
    });

    // Store hashed refresh token in DB
    const tokenHash = this.cryptoService.hashToken(refreshToken);
    const refreshExpiresIn =
      this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') || '7d';
    const expiresAt = new Date();
    const days = parseInt(refreshExpiresIn, 10) || 7;
    expiresAt.setDate(expiresAt.getDate() + days);

    await this.refreshTokenModel.create({
      userId,
      tokenHash,
      expiresAt,
    });

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
   * Validates refresh token against DB (must exist, not revoked, not expired).
   * Rotates the refresh token: issues new one, revokes old one.
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

    // Verify token exists in DB and is not revoked
    const tokenHash = this.cryptoService.hashToken(refreshToken);
    const storedToken = await this.refreshTokenModel.findOne({
      where: {
        userId: user.id,
        tokenHash,
        revokedAt: null,
      },
    });

    if (!storedToken) {
      throw new UnauthorizedException(apiError('common.unauthorized'));
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException(apiError('common.unauthorized'));
    }

    // Revoke old token
    await storedToken.update({ revokedAt: new Date() });

    // Issue new token pair (rotation)
    const tokens = await this.generateAndStoreTokens(user.id, user.email);

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
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

      if (this.configService.get('NODE_ENV') !== 'production') {
        const frontendUrl =
          this.configService.get('FRONTEND_URL') || 'http://localhost:4200';
        const resetLink = `${frontendUrl}/auth/new-password?token=${resetToken}`;
        return {
          message:
            'If your email is registered, you will receive a password reset link.',
          resetLink,
        };
      }
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
      firstName: payload.given_name?.trim() || 'User',
      lastName: payload.family_name?.trim() || '',
      language,
    };

    return this.handleOAuthSignIn('GOOGLE', profile);
  }

  async registerWithFacebook(accessToken: string, language?: Locale) {
    const appId = this.configService.get<string>('FACEBOOK_APP_ID');
    const appSecret = this.configService.get<string>('FACEBOOK_APP_SECRET');
    if (!appId || !appSecret) {
      throw new BadRequestException(
        apiError('auth.providerUnavailable', { provider: 'Facebook' }),
      );
    }

    const appAccessToken = `${appId}|${appSecret}`;

    const debugUrl = `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appAccessToken)}`;
    let debugRes: Response;
    try {
      debugRes = await fetch(debugUrl);
    } catch (err) {
      this.logger.warn(`Facebook debug_token request failed: ${err}`);
      throw new UnauthorizedException(
        apiError('auth.providerSignInFailed', { provider: 'Facebook' }),
      );
    }

    const debugData = (await debugRes.json()) as {
      data?: { valid?: boolean; user_id?: string };
    };
    if (!debugData?.data?.valid || !debugData.data.user_id) {
      throw new UnauthorizedException(
        apiError('auth.providerSignInFailed', { provider: 'Facebook' }),
      );
    }

    const meUrl = `https://graph.facebook.com/me?fields=id,email,first_name,last_name&access_token=${encodeURIComponent(accessToken)}`;
    let meRes: Response;
    try {
      meRes = await fetch(meUrl);
    } catch (err) {
      this.logger.warn(`Facebook me request failed: ${err}`);
      throw new UnauthorizedException(
        apiError('auth.providerSignInFailed', { provider: 'Facebook' }),
      );
    }

    const me = (await meRes.json()) as {
      id?: string;
      email?: string;
      first_name?: string;
      last_name?: string;
      error?: { message: string };
    };
    if (me.error || !me.id) {
      this.logger.warn(
        `Facebook me request returned no profile: ${me.error?.message ?? 'no id'}`,
        'AuthService',
      );
      throw new UnauthorizedException(
        apiError('auth.providerSignInFailed', { provider: 'Facebook' }),
      );
    }

    const email = me.email?.trim();
    if (!email) {
      throw new BadRequestException(
        apiError('auth.providerNoEmail', { provider: 'Facebook' }),
      );
    }

    const profile = {
      providerUserId: me.id,
      email,
      firstName: me.first_name?.trim() || 'User',
      lastName: me.last_name?.trim() || '',
      language,
    };

    return this.handleOAuthSignIn('FACEBOOK', profile);
  }

  /**
   * Shared OAuth flow: find or create user, assign role/profile if new, return JWT + user.
   *
   * Security: If an existing email/password user is found and no social account link exists,
   * we require the user to link their account explicitly (prevents OAuth account takeover).
   */
  private async handleOAuthSignIn(
    provider: 'GOOGLE' | 'FACEBOOK',
    profile: OAuthProfile,
  ) {
    const transaction = await this.sequelize.transaction();
    let found: Awaited<ReturnType<UserService['findOrCreateFromOAuth']>>;
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
    if (isNewUser) {
      this.linkGuestStripeCustomers(user.id, user.email);
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
