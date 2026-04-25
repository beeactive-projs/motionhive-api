import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op, QueryTypes, Transaction, literal } from 'sequelize';
import { Sequelize } from 'sequelize-typescript';
import { User } from './entities/user.entity';
import {
  SocialAccount,
  SocialProvider,
} from './entities/social-account.entity';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { CryptoService } from '../../common/services';
import { CloudinaryService } from '../../common/services/cloudinary.service';
import { InstructorProfile } from '../profile/entities/instructor-profile.entity';
import { GroupMember } from '../group/entities/group-member.entity';
import { SessionParticipant } from '../session/entities/session-participant.entity';
import {
  InstructorClient,
  InstructorClientStatus,
} from '../client/entities/instructor-client.entity';
import {
  ClientRequest,
  ClientRequestStatus,
} from '../client/entities/client-request.entity';
import { Invitation } from '../invitation/entities/invitation.entity';
import { Role } from '../role/entities/role.entity';
import { SearchIndexService } from '../search/search-index.service';

/**
 * Roles that must never appear in user-picker search results, regardless of
 * any other role the account carries. Even if someone is both ADMIN and USER,
 * they are not an invitable "client".
 */
const SEARCH_HIDDEN_ROLES = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'] as const;

export interface OAuthProfile {
  providerUserId: string;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * GDPR Article 20 data-portability export shape. Every field is the
 * `.toJSON()` output of its Sequelize model, which is why the
 * per-field types are unknown to the typechecker (Sequelize instance
 * methods are stripped but the scalar shape isn't enumerated). Keep
 * the categories strict; the inner shapes can evolve with the entities.
 */
export interface UserDataExport {
  exportedAt: string;
  user: Record<string, unknown>;
  socialAccounts: Record<string, unknown>[];
  instructorProfile: Record<string, unknown> | null;
  groupMemberships: Record<string, unknown>[];
  sessionParticipations: Record<string, unknown>[];
  clientRelationships: Record<string, unknown>[];
  invitations: Record<string, unknown>[];
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
    private sequelize: Sequelize,
    private configService: ConfigService,
    private cryptoService: CryptoService,
    private readonly cloudinaryService: CloudinaryService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    private readonly searchIndexService: SearchIndexService,
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
   * Search active users by partial match on email, first name, or last name.
   * Intended for pickers like "invite a client" — always case-insensitive,
   * always capped at 20 results, never returns sensitive fields.
   *
   * @param params.q - Partial match (min 2 chars). Matched via ILIKE.
   * @param params.role - Optional role name filter (e.g. 'USER').
   * @param params.excludeUserId - Caller's own id, excluded from results.
   * @param params.excludeConnectedToInstructorId - When set, excludes users
   *   who already have an ACTIVE or PENDING instructor_client row with that
   *   instructor, or a PENDING client_request in either direction.
   * @param params.limit - 1–20, default 10.
   */
  async searchUsers(params: {
    q: string;
    role?: string;
    excludeUserId?: string;
    excludeConnectedToInstructorId?: string;
    limit?: number;
  }): Promise<
    Array<{
      id: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
      avatarUrl: string | null;
    }>
  > {
    const limit = Math.min(Math.max(params.limit ?? 10, 1), 20);
    const term = params.q.trim();
    if (term.length < 2) return [];
    const like = `%${term}%`;

    const notInUserIds: string[] = [];
    if (params.excludeUserId) notInUserIds.push(params.excludeUserId);

    if (params.excludeConnectedToInstructorId) {
      const instructorId = params.excludeConnectedToInstructorId;
      const [connections, pendingRequests] = await Promise.all([
        InstructorClient.findAll({
          where: {
            instructorId,
            status: {
              [Op.in]: [
                InstructorClientStatus.ACTIVE,
                InstructorClientStatus.PENDING,
              ],
            },
          },
          attributes: ['clientId'],
        }),
        ClientRequest.findAll({
          where: {
            status: ClientRequestStatus.PENDING,
            expiresAt: { [Op.gt]: new Date() },
            [Op.or]: [{ fromUserId: instructorId }, { toUserId: instructorId }],
          },
          attributes: ['fromUserId', 'toUserId'],
        }),
      ]);

      for (const row of connections) notInUserIds.push(row.clientId);
      for (const row of pendingRequests) {
        if (row.fromUserId && row.fromUserId !== instructorId)
          notInUserIds.push(row.fromUserId);
        if (row.toUserId && row.toUserId !== instructorId)
          notInUserIds.push(row.toUserId);
      }
    }

    const where: Record<string, unknown> = {
      isActive: true,
      [Op.or]: [
        { email: { [Op.iLike]: like } },
        { firstName: { [Op.iLike]: like } },
        { lastName: { [Op.iLike]: like } },
      ],
      // Hard block: users with staff roles (admin/super/support) never appear
      // in pickers, regardless of any other role they carry.
      [Op.and]: literal(
        `NOT EXISTS (
          SELECT 1 FROM user_role ur_hide
          JOIN role r_hide ON r_hide.id = ur_hide.role_id
          WHERE ur_hide.user_id = "User"."id"
            AND r_hide.name IN (${SEARCH_HIDDEN_ROLES.map((r) => `'${r}'`).join(', ')})
        )`,
      ),
    };
    if (notInUserIds.length > 0) {
      where.id = { [Op.notIn]: Array.from(new Set(notInUserIds)) };
    }

    const include = params.role
      ? [
          {
            model: Role,
            through: { attributes: [] },
            where: { name: params.role },
            required: true,
            attributes: [],
          },
        ]
      : undefined;

    const rows = await this.userModel.findAll({
      where,
      include,
      attributes: ['id', 'email', 'firstName', 'lastName', 'avatarUrl'],
      limit,
      order: [
        ['firstName', 'ASC'],
        ['lastName', 'ASC'],
      ],
    });

    return rows.map((u) => ({
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      avatarUrl: u.avatarUrl,
    }));
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

    await this.searchIndexService.upsertUser(user.id, transaction);

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
    const user = await this.userModel.create(
      {
        email: profile.email,
        passwordHash: null,
        firstName: profile.firstName,
        lastName: profile.lastName,
        isEmailVerified: true,
      },
      { transaction },
    );
    await this.searchIndexService.upsertUser(user.id, transaction);
    return user;
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
  async updateUser(
    userId: string,
    dto: UpdateUserDto,
    transaction?: Transaction,
  ): Promise<User> {
    const user = await this.userModel.findByPk(userId, { transaction });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Lock countryCode once a Stripe Connect account exists. Stripe does
    // not allow country changes on an account; letting the user re-type
    // theirs would cause a silent mismatch between profile and Stripe.
    // Raw query avoids a cross-module entity import.
    if (dto.countryCode !== undefined && dto.countryCode !== user.countryCode) {
      const [row] = await this.sequelize.query<{ id: string }>(
        'SELECT id FROM stripe_account WHERE user_id = :userId LIMIT 1',
        {
          replacements: { userId },
          type: QueryTypes.SELECT,
          transaction,
        },
      );
      if (row) {
        throw new BadRequestException(
          'Country cannot be changed once payments are set up. ' +
            'Contact support to migrate your Stripe account.',
        );
      }
    }

    await user.update(dto, { transaction });
    await this.searchIndexService.upsertUser(user.id, transaction);
    return user;
  }

  /**
   * Upload a new profile picture for the given user.
   *
   * Stores the image in Cloudinary under the `avatars/` folder, saves
   * the secure URL + public_id on the user row, and DELETES the
   * previous Cloudinary asset (if any) so we don't leak storage on
   * every re-upload. Cleanup runs after the DB write — if Cloudinary
   * fails to delete the old asset we log and move on rather than
   * undoing the user-visible change.
   */
  async uploadAvatar(userId: string, file: Express.Multer.File): Promise<User> {
    const user = await this.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const previousPublicId = user.avatarPublicId;
    const { url, publicId } = await this.cloudinaryService.uploadImage(
      file,
      'avatars',
    );
    user.avatarUrl = url;
    user.avatarPublicId = publicId;
    await user.save();

    if (previousPublicId && previousPublicId !== publicId) {
      try {
        await this.cloudinaryService.deleteImage(previousPublicId);
      } catch (err) {
        // Non-fatal — the new avatar is already live; the old asset
        // just lingers. A periodic sweeper can clean orphans later.
        this.logger.warn(
          `Failed to delete old avatar ${previousPublicId} for user ${userId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
          'UserService',
        );
      }
    }

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

    // Pull the user out of the search index. We also remove the
    // matching instructor row (keyed on userId) since they share an
    // entity_id space — the upsertInstructor call from any future
    // profile reactivation will put it back.
    await this.searchIndexService.removeIfExists('user', userId);
    await this.searchIndexService.removeIfExists('instructor', userId);

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
  async exportUserData(userId: string): Promise<UserDataExport> {
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

    // Never log the plain token — even at DEBUG. Any log sink with a
    // 'debug' floor (Datadog, Sentry breadcrumbs, Railway log drain)
    // would turn this into an account-takeover primitive. Token
    // delivery goes via email; anyone debugging mismatches should
    // read the email or the stored hash, not the plaintext.
    return token;
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
