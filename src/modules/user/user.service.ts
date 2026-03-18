import {
  Injectable,
  ConflictException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op, Transaction } from 'sequelize';
import { User } from './entities/user.entity';
import {
  SocialAccount,
  SocialProvider,
} from './entities/social-account.entity';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CryptoService } from '../../common/services';
import { UserProfile } from '../profile/entities/user-profile.entity';
import { InstructorProfile } from '../profile/entities/instructor-profile.entity';
import { GroupMember } from '../group/entities/group-member.entity';
import { SessionParticipant } from '../session/entities/session-participant.entity';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import { Invitation } from '../invitation/entities/invitation.entity';

export interface OAuthProfile {
  providerUserId: string;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * User Service
 *
 * Handles all business logic related to users:
 * - Creating users
 * - Finding users
 * - Password validation
 * - Account lockout
 * - Token generation for password reset/email verification
 *
 * This is the "brain" of the user module.
 * Controllers call these methods, services interact with the database.
 */
@Injectable()
export class UserService {
  constructor(
    @InjectModel(User)
    private userModel: typeof User,
    @InjectModel(SocialAccount)
    private socialAccountModel: typeof SocialAccount,
    private configService: ConfigService,
    private cryptoService: CryptoService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Find a user by email address (exact, case-sensitive match).
   *
   * Used by the auth flow for login, registration duplicate checks, and
   * OAuth account linking. Callers are responsible for normalising the
   * email (lowercase + trim) before passing it in.
   *
   * @param email - The raw email address to look up
   * @returns The matching User, or null if no account exists with that email
   */
  async findByEmail(email: string): Promise<User | null> {
    return this.userModel.findOne({
      where: { email },
    });
  }

  /**
   * Find a user by their primary key (UUID).
   *
   * @param id - The user's UUID
   * @returns The matching User, or null if no account exists with that ID
   */
  async findById(id: string): Promise<User | null> {
    return this.userModel.findByPk(id);
  }

  /**
   * Create a new user from an email/password registration.
   *
   * Steps:
   * 1. Reject early if the email is already taken (checked before bcrypt to avoid
   *    wasting CPU on the hash when the request will fail anyway)
   * 2. Hash the password with bcrypt at the configured round count (default 12)
   * 3. Persist the user record
   *
   * The created user will have isEmailVerified=false. The caller is responsible
   * for generating and sending an email verification token.
   *
   * @param userData - Validated registration payload
   * @param transaction - Optional Sequelize transaction for atomic operations
   * @returns The newly created User record
   * @throws ConflictException if an account with this email already exists
   */
  async create(
    userData: CreateUserDto,
    transaction?: Transaction,
  ): Promise<User> {
    // Check if user already exists (do this BEFORE expensive bcrypt operation)
    const existingUser = await this.findByEmail(userData.email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    // ✅ SECURITY FIX: Increased bcrypt rounds from 10 to 12
    // More rounds = more secure but slower (12 is good balance)
    const bcryptRounds = this.configService.get<number>('BCRYPT_ROUNDS') || 12;
    const hashedPassword = await bcrypt.hash(userData.password, bcryptRounds);

    // Create user
    const user = await this.userModel.create(
      {
        email: userData.email,
        passwordHash: hashedPassword,
        firstName: userData.firstName,
        lastName: userData.lastName,
        phone: userData.phone,
      },
      { transaction },
    );

    return user;
  }

  /**
   * Find or create a user from an OAuth provider (Google, Facebook).
   *
   * Three cases are handled in order:
   * 1. **Already linked** — a SocialAccount row exists for this provider + providerUserId.
   *    Return the linked user immediately.
   * 2. **Email match** — an account exists with the same email. Link the social account,
   *    but only if the email is already verified (prevents OAuth account takeover on
   *    unverified email/password accounts).
   * 3. **New user** — no match. Create a new User (no passwordHash) and SocialAccount.
   *    OAuth users are auto-verified (isEmailVerified=true).
   *
   * @param provider - The OAuth provider (GOOGLE | FACEBOOK | APPLE)
   * @param profile - Normalised profile data from the provider (email, name, providerUserId)
   * @param transaction - Optional Sequelize transaction
   * @returns { user, isNewUser } — isNewUser is true only when a brand-new account was created
   * @throws ConflictException if the email matches an unverified password account
   */
  async findOrCreateFromOAuth(
    provider: SocialProvider,
    profile: OAuthProfile,
    transaction?: Transaction,
  ): Promise<{ user: User; isNewUser: boolean }> {
    // 1. Already linked?
    const existingSocial = await this.socialAccountModel.findOne({
      where: { provider, providerUserId: profile.providerUserId },
      include: [{ model: User, as: 'user' }],
      transaction,
    });
    if (existingSocial?.user) {
      return { user: existingSocial.user, isNewUser: false };
    }

    // 2. User exists by email? Link social account only if safe.
    const existingUser = await this.findByEmail(profile.email);
    if (existingUser) {
      // If user has a password (email/password account), only auto-link
      // if their email is already verified (proves ownership).
      // Otherwise, reject to prevent OAuth account takeover.
      if (existingUser.passwordHash && !existingUser.isEmailVerified) {
        throw new ConflictException(
          'An account with this email already exists. Please log in with your password and verify your email before linking a social account.',
        );
      }

      await this.socialAccountModel.create(
        {
          userId: existingUser.id,
          provider,
          providerUserId: profile.providerUserId,
          providerEmail: profile.email,
        },
        { transaction },
      );
      return { user: existingUser, isNewUser: false };
    }

    // 3. Create new user + social account
    const user = await this.createFromOAuth(profile, transaction);
    await this.socialAccountModel.create(
      {
        userId: user.id,
        provider,
        providerUserId: profile.providerUserId,
        providerEmail: profile.email,
      },
      { transaction },
    );
    return { user, isNewUser: true };
  }

  /**
   * Create a new user from an OAuth profile (no password).
   *
   * Used internally by findOrCreateFromOAuth when no existing account is found.
   * The created user has passwordHash=null and isEmailVerified=true (identity
   * was verified by the OAuth provider).
   *
   * @param profile - Normalised profile data from the OAuth provider
   * @param transaction - Optional Sequelize transaction
   * @returns The newly created User record
   * @throws ConflictException if the email is already taken (race condition guard)
   */
  async createFromOAuth(
    profile: OAuthProfile,
    transaction?: Transaction,
  ): Promise<User> {
    const existingUser = await this.findByEmail(profile.email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }
    return this.userModel.create(
      {
        email: profile.email,
        passwordHash: null,
        firstName: profile.firstName,
        lastName: profile.lastName,
        isEmailVerified: true,
      },
      { transaction },
    );
  }

  /**
   * Update basic profile fields on a user (name, phone, avatar, language, timezone).
   *
   * All fields in the DTO are optional — only provided fields are overwritten.
   *
   * @param userId - The user's UUID
   * @param dto - Partial update payload (UpdateUserDto)
   * @returns The updated User record
   * @throws NotFoundException if no user exists with that ID
   */
  async updateUser(userId: string, dto: UpdateUserDto): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    await user.update(dto);
    return user;
  }

  /**
   * Soft-delete a user account (GDPR right to erasure).
   *
   * Sets isActive=false and calls Sequelize's paranoid destroy(), which sets
   * deletedAt rather than issuing a DELETE. The record is retained for audit
   * purposes but is excluded from all normal queries automatically.
   *
   * Caller (AuthService) is responsible for revoking active tokens before
   * or after this call.
   *
   * @param userId - The user's UUID
   * @throws NotFoundException if no user exists with that ID
   */
  async deleteAccount(userId: string): Promise<void> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    user.isActive = false;
    await user.save();
    await user.destroy(); // Soft delete (paranoid: true)

    this.logger.log(`Account deleted (soft): ${userId}`, 'UserService');
  }

  /**
   * Export all data held for a user (GDPR Article 20 — Right to Data Portability).
   *
   * Collects and returns a single JSON blob containing all records linked to
   * the user: account info (sensitive token fields excluded), social accounts,
   * user profile, instructor profile, group memberships, session participations,
   * instructor-client relationships, and group invitations.
   *
   * All queries run in parallel via Promise.all for performance.
   *
   * @param userId - The user's UUID
   * @returns A plain object keyed by data category, with an exportedAt timestamp
   * @throws NotFoundException if no user exists with that ID
   */
  async exportUserData(userId: string): Promise<Record<string, any>> {
    const user = await this.userModel.findByPk(userId, {
      attributes: {
        exclude: [
          'passwordHash',
          'passwordResetToken',
          'passwordResetExpires',
          'emailVerificationToken',
          'emailVerificationExpires',
        ],
      },
    });

    if (!user) {
      throw new ConflictException('User not found');
    }

    const [
      socialAccounts,
      userProfile,
      instructorProfile,
      groupMemberships,
      sessionParticipations,
      clientRelationships,
      invitations,
    ] = await Promise.all([
      this.socialAccountModel.findAll({
        where: { userId },
        attributes: ['provider', 'providerEmail', 'createdAt'],
      }),
      UserProfile.findOne({ where: { userId } }),
      InstructorProfile.findOne({ where: { userId } }),
      GroupMember.findAll({
        where: { userId },
        attributes: ['groupId', 'isOwner', 'nickname', 'joinedAt', 'leftAt'],
      }),
      SessionParticipant.findAll({
        where: { userId },
        attributes: ['sessionId', 'status', 'checkedInAt', 'createdAt'],
      }),
      InstructorClient.findAll({
        where: { [Op.or]: [{ instructorId: userId }, { clientId: userId }] },
        attributes: ['instructorId', 'clientId', 'status', 'createdAt'],
      }),
      Invitation.findAll({
        where: { email: user.email },
        attributes: ['groupId', 'acceptedAt', 'declinedAt', 'createdAt'],
      }),
    ]);

    this.logger.log(`Data export generated for user: ${userId}`, 'UserService');

    return {
      exportedAt: new Date().toISOString(),
      user: user.toJSON(),
      socialAccounts: socialAccounts.map((s) => s.toJSON()),
      userProfile: userProfile?.toJSON() || null,
      instructorProfile: instructorProfile?.toJSON() || null,
      groupMemberships: groupMemberships.map((m) => m.toJSON()),
      sessionParticipations: sessionParticipations.map((p) => p.toJSON()),
      clientRelationships: clientRelationships.map((c) => c.toJSON()),
      invitations: invitations.map((i) => i.toJSON()),
    };
  }

  /**
   * Validate a plain-text password against the user's stored bcrypt hash.
   *
   * Returns false immediately for OAuth-only users (passwordHash is null) so
   * they cannot log in via the email/password flow.
   *
   * bcrypt.compare extracts the salt from the stored hash and re-hashes the
   * candidate password before comparing — this is timing-safe by design.
   *
   * @param user - The user record containing the passwordHash
   * @param password - The plain-text password submitted by the user
   * @returns true if the password matches, false otherwise
   */
  async validatePassword(user: User, password: string): Promise<boolean> {
    if (!user.passwordHash) return false; // OAuth-only user has no password
    return bcrypt.compare(password, user.passwordHash);
  }

  /**
   * Check whether a user account is currently locked out.
   *
   * An account is locked when lockedUntil is set to a future timestamp.
   * This is set automatically by incrementFailedAttempts after 5 consecutive
   * failures. The lock expires naturally — no explicit unlock is needed.
   *
   * @param user - The user record to check
   * @returns true if the account is locked right now, false otherwise
   */
  isAccountLocked(user: User): boolean {
    if (!user.lockedUntil) return false;
    return new Date() < user.lockedUntil;
  }

  /**
   * Record a failed login attempt and lock the account if the threshold is reached.
   *
   * After MAX_ATTEMPTS (5) consecutive failures the account is locked for
   * LOCK_DURATION_MINUTES (15). The lockout timestamp is stored in lockedUntil;
   * isAccountLocked reads it on the next login attempt.
   *
   * Should be called by AuthService on every failed password validation.
   *
   * @param user - The user who failed to log in
   */
  async incrementFailedAttempts(user: User): Promise<void> {
    const MAX_ATTEMPTS = 5;
    const LOCK_DURATION_MINUTES = 15;

    user.failedLoginAttempts += 1;

    if (user.failedLoginAttempts >= MAX_ATTEMPTS) {
      // Lock the account
      const lockedUntil = new Date();
      lockedUntil.setMinutes(lockedUntil.getMinutes() + LOCK_DURATION_MINUTES);
      user.lockedUntil = lockedUntil;
    }

    await user.save();
  }

  /**
   * Clear the failed login counter and lockout state after a successful login.
   *
   * Also records lastLoginAt so the dashboard can show "Last seen" info.
   * Should be called by AuthService immediately after a valid password login
   * or successful OAuth sign-in.
   *
   * @param user - The user who just logged in successfully
   */
  async resetFailedAttempts(user: User): Promise<void> {
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.lastLoginAt = new Date();
    await user.save();
  }

  /**
   * Generate a one-time email verification token for a user.
   *
   * Creates a cryptographically secure random token, hashes it with SHA-256,
   * and stores only the hash + expiry in the database (never the plain token).
   * The plain token is returned so the caller can embed it in a verification link
   * sent to the user's email address. Valid for 24 hours.
   *
   * @param user - The user whose email needs verification
   * @param transaction - Optional Sequelize transaction
   * @returns The plain token to embed in the verification email link
   */
  async generateEmailVerificationToken(
    user: User,
    transaction?: Transaction,
  ): Promise<string> {
    const { token, hashedToken, expiresAt } =
      this.cryptoService.generateTokenWithExpiry(24); // 24 hour validity

    user.emailVerificationToken = hashedToken;
    user.emailVerificationExpires = expiresAt;
    await user.save({ transaction });

    return token; // Return plain token to send via email
  }

  /**
   * Look up a user by their email verification token.
   *
   * Hashes the provided plain token and queries the DB for a match.
   * Returns null (rather than throwing) for both invalid and expired tokens
   * so the caller can return a consistent "invalid link" error to the user.
   *
   * @param token - The plain token from the verification email link
   * @returns The matching User, or null if the token is invalid or expired
   */
  async findByEmailVerificationToken(token: string): Promise<User | null> {
    const hashedToken = this.cryptoService.hashToken(token);

    const user = await this.userModel.findOne({
      where: {
        emailVerificationToken: hashedToken,
      },
    });

    // Check if token is expired
    if (user && user.emailVerificationExpires) {
      if (new Date() > user.emailVerificationExpires) {
        return null; // Token expired
      }
    }

    return user;
  }

  /**
   * Mark a user's email address as verified and clear the verification token.
   *
   * Should be called by AuthService after successfully validating the token
   * from the verification link. Clears both the token hash and its expiry so
   * the link cannot be reused.
   *
   * @param user - The user whose email has been verified
   */
  async markEmailVerified(user: User): Promise<void> {
    user.isEmailVerified = true;
    user.emailVerificationToken = null;
    user.emailVerificationExpires = null;
    await user.save();
  }

  /**
   * Generate a one-time password reset token for a user.
   *
   * Creates a cryptographically secure random token, hashes it with SHA-256,
   * and stores only the hash + expiry in the database. The plain token is
   * returned so the caller can embed it in the reset link sent via email.
   * Valid for 1 hour.
   *
   * In non-production environments an extra DB read is performed to confirm the
   * token was persisted correctly, and the token + hash are logged at DEBUG level
   * to aid local debugging. This code path never runs in production.
   *
   * @param user - The user requesting a password reset
   * @returns The plain token to embed in the password reset email link
   */
  async generatePasswordResetToken(user: User): Promise<string> {
    const { token, hashedToken, expiresAt } =
      this.cryptoService.generateTokenWithExpiry(1); // 1 hour validity

    user.passwordResetToken = hashedToken;
    user.passwordResetExpires = expiresAt;
    await user.save();

    // Dev-only debugging: helps verify FE/BE token alignment.
    // The token is still hashed in DB; this only logs to local console.
    if (this.configService.get('NODE_ENV') !== 'production') {
      const reloaded = await this.userModel.findByPk(user.id, {
        attributes: [
          'id',
          'email',
          'passwordResetToken',
          'passwordResetExpires',
        ],
      });
      this.logger.debug?.(
        `Password reset token generated for ${user.email}: token=${token} hashed=${hashedToken} expiresAt=${expiresAt.toISOString()} stored=${reloaded?.passwordResetToken} storedExpires=${reloaded?.passwordResetExpires?.toISOString()}`,
        'UserService',
      );
    }

    return token; // Return plain token to send via email
  }

  /**
   * Look up a user by their password reset token.
   *
   * Tokens are stored as SHA-256 hashes. The lookup tries both interpretations
   * of the incoming value to be robust against edge cases:
   * 1. Plain token (expected) — hashed once and compared against the DB.
   * 2. Pre-hashed value — compared against the DB as-is (handles misconfigured
   *    clients or legacy email links that might have double-hashed the token).
   *
   * Returns null for both invalid and expired tokens so the caller can surface
   * a consistent "invalid or expired link" error without leaking which case it is.
   *
   * @param token - The token value received from the password reset link
   * @returns The matching User, or null if the token is invalid or expired
   */
  async findByPasswordResetToken(token: string): Promise<User | null> {
    // Tokens are stored hashed (SHA-256) for security, but the token we receive from
    // the frontend/email link may be either:
    // - the plain token (expected) -> must be hashed once to match DB
    // - already a SHA-256 hex string (misconfiguration / legacy links) -> must match DB as-is
    //
    // To be robust, try both.
    const normalized = token.trim();
    const hashedToken = this.cryptoService.hashToken(normalized);

    const user =
      (await this.userModel.findOne({
        where: { passwordResetToken: normalized },
      })) ??
      (await this.userModel.findOne({
        where: { passwordResetToken: hashedToken },
      }));

    // Check if token is expired
    if (user && user.passwordResetExpires) {
      if (new Date() > user.passwordResetExpires) {
        return null; // Token expired
      }
    }

    return user;
  }

  /**
   * Complete a password reset — hash the new password and clear all reset state.
   *
   * Called by AuthService after the reset token has been validated. In addition
   * to updating the password hash, this method:
   * - Clears the reset token and its expiry (token is single-use)
   * - Resets the failed login counter and removes any active lockout
   * - Records passwordChangedAt so stale refresh tokens can be invalidated
   *
   * AuthService is responsible for revoking all active refresh tokens after
   * this call returns.
   *
   * @param user - The user whose password is being reset
   * @param newPassword - The validated plain-text new password
   */
  async resetPassword(user: User, newPassword: string): Promise<void> {
    const bcryptRounds = this.configService.get<number>('BCRYPT_ROUNDS') || 12;
    user.passwordHash = await bcrypt.hash(newPassword, bcryptRounds);

    // Clear reset token and lockout state
    user.passwordResetToken = null;
    user.passwordResetExpires = null;
    user.failedLoginAttempts = 0;
    user.lockedUntil = null;
    user.passwordChangedAt = new Date();

    await user.save();
  }

  /**
   * Change the password for an authenticated user who knows their current password.
   *
   * Unlike resetPassword, this path does not clear the reset token or lockout
   * state — the user is already authenticated. It does record passwordChangedAt
   * so the auth interceptor can detect and invalidate tokens issued before the
   * change if that check is added in the future.
   *
   * The caller (AuthService) is responsible for verifying the current password
   * before invoking this method.
   *
   * @param user - The authenticated user changing their password
   * @param newPassword - The validated plain-text new password
   */
  async changePassword(user: User, newPassword: string): Promise<void> {
    const bcryptRounds = this.configService.get<number>('BCRYPT_ROUNDS') || 12;
    user.passwordHash = await bcrypt.hash(newPassword, bcryptRounds);
    user.passwordChangedAt = new Date();
    await user.save();
  }
}
