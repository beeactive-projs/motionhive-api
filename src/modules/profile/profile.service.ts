import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op, Transaction, UniqueConstraintError, literal } from 'sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { InstructorProfile } from './entities/instructor-profile.entity';
import { CreateInstructorProfileDto } from './dto/create-instructor-profile.dto';
import { UpdateInstructorProfileDto } from './dto/update-instructor-profile.dto';
import { UpdateFullProfileDto } from './dto/update-full-profile.dto';
import { DiscoverInstructorsDto } from './dto/discover-instructors.dto';
import { UpdatePrivacySettingsDto } from './dto/update-privacy-settings.dto';
import { UpdateHandleDto } from './dto/update-handle.dto';
import {
  isFieldVisible,
  resolveLevel,
  type PublicProfileAudience,
} from './profile-privacy';
import { RoleService } from '../role/role.service';
import { UserService } from '../user/user.service';
import {
  User,
  USER_SAFE_ATTRIBUTES,
  type PrivacyControlledField,
  type ProfilePrivacyLevel,
  type UserPrivacySettings,
} from '../user/entities/user.entity';
import {
  InstructorClient,
  InstructorClientStatus,
} from '../client/entities/instructor-client.entity';
import { buildSearchTerm } from '../../common/utils/search.utils';
import { apiError } from '../../common/i18n';
import { SearchIndexService } from '../search/search-index.service';
import { ReviewService } from '../review/review.service';
import { GroupService } from '../group/group.service';
import { VenueService } from '../venue/venue.service';

// The privacy rules live in profile-privacy.ts, which group and other
// modules read without importing this service. Re-exported for the spec.
export { isFieldVisible } from './profile-privacy';
export type { PublicProfileAudience } from './profile-privacy';

/**
 * Roles that are uninteresting on a public profile. `USER` is implicit
 * for every account; staff roles are surfaced via the existing badge
 * pattern (`displayBadges` on the FE), so this list is just the noise
 * filter the API applies before returning `displayRoles`.
 */
const HIDDEN_DISPLAY_ROLES = new Set(['USER']);

/**
 * Manages the instructor profile. Identity (name, email, country,
 * city) lives on `user` — `instructor_profile` doesn't duplicate
 * location, so discovery queries JOIN through the user row.
 */
@Injectable()
export class ProfileService {
  constructor(
    @InjectModel(InstructorProfile)
    private readonly instructorProfileModel: typeof InstructorProfile,
    private readonly sequelize: Sequelize,
    private readonly roleService: RoleService,
    private readonly userService: UserService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    private readonly searchIndexService: SearchIndexService,
    private readonly reviewService: ReviewService,
    private readonly groupService: GroupService,
    private readonly venueService: VenueService,
  ) {}

  // =====================================================
  // INSTRUCTOR PROFILE
  // =====================================================

  /**
   * Create an instructor profile within an existing transaction.
   *
   * Used during registration when isInstructor=true, so the entire
   * registration (user + instructor profile + roles) is atomic. The
   * caller owns the transaction commit/rollback.
   */
  async createInstructorProfileInTransaction(
    userId: string,
    firstName: string,
    lastName: string,
    transaction: Transaction,
  ): Promise<InstructorProfile> {
    const profile = await this.instructorProfileModel.create(
      {
        userId,
        displayName: `${firstName} ${lastName}`,
        bio: null,
        specializations: [],
        certifications: [],
        yearsOfExperience: null,
        isAcceptingClients: true,
        isPublic: false,
        socialLinks: {},
        showSocialLinks: true,
        showEmail: true,
        showPhone: false,
      },
      { transaction },
    );

    await this.roleService.assignRoleToUserByName(
      userId,
      'INSTRUCTOR',
      undefined,
      undefined,
      transaction,
    );

    await this.searchIndexService.upsertInstructor(userId, transaction);

    return profile;
  }

  /**
   * Create instructor profile and assign INSTRUCTOR role
   *
   * This is the "I want to instruct activities" action.
   * Creates the profile AND adds the INSTRUCTOR role to the user.
   */
  async createInstructorProfile(
    userId: string,
    dto: CreateInstructorProfileDto,
  ): Promise<InstructorProfile> {
    const existing = await this.instructorProfileModel.findOne({
      where: { userId: userId },
    });

    if (existing) {
      throw new ConflictException(apiError('profile.coachProfileExists'));
    }

    const transaction = await this.sequelize.transaction();
    try {
      const profile = await this.instructorProfileModel.create(
        {
          userId: userId,
          displayName: dto.displayName || null,
          bio: dto.bio ?? null,
          specializations: dto.specializations ?? [],
          certifications: dto.certifications ?? [],
          yearsOfExperience: dto.yearsOfExperience ?? null,
          isAcceptingClients: dto.isAcceptingClients ?? true,
          isPublic: dto.isPublic ?? false,
          socialLinks: dto.socialLinks ?? {},
          showSocialLinks: dto.showSocialLinks ?? true,
          showEmail: dto.showEmail ?? true,
          showPhone: dto.showPhone ?? false,
        },
        { transaction },
      );

      await this.roleService.assignRoleToUserByName(
        userId,
        'INSTRUCTOR',
        undefined,
        undefined,
        transaction,
      );

      await this.searchIndexService.upsertInstructor(userId, transaction);

      await transaction.commit();

      this.logger.log(
        `User ${userId} activated instructor profile`,
        'ProfileService',
      );

      return profile;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async getInstructorProfile(
    userId: string,
  ): Promise<InstructorProfile | null> {
    return this.instructorProfileModel.findOne({
      where: { userId: userId },
    });
  }

  async updateInstructorProfile(
    userId: string,
    dto: UpdateInstructorProfileDto,
    transaction?: Transaction,
  ): Promise<InstructorProfile> {
    const profile = await this.instructorProfileModel.findOne({
      where: { userId: userId },
      transaction,
    });

    if (!profile) {
      throw new NotFoundException(apiError('profile.noCoachProfile'));
    }

    await profile.update(dto, { transaction });
    await this.searchIndexService.upsertInstructor(userId, transaction);
    return profile;
  }

  // =====================================================
  // UNIFIED PROFILE UPDATE
  // =====================================================

  /**
   * Update full profile (user + instructor) in one call.
   *
   * Only provided sections are updated; omitted sections are skipped.
   * Country/city live on `user` — pass them via `account`.
   *
   * The account update, instructor update, and instructor activation
   * (when going from "no instructor profile" to "wants to instruct")
   * all run inside the SAME Sequelize-managed transaction. If any
   * step fails the whole call rolls back, so callers never observe
   * partial state.
   */
  async updateFullProfile(userId: string, dto: UpdateFullProfileDto) {
    return this.sequelize.transaction(async (tx) => {
      const results: {
        account?: User;
        instructor?: InstructorProfile;
      } = {};

      if (dto.account && Object.keys(dto.account).length > 0) {
        results.account = await this.userService.updateUser(
          userId,
          dto.account,
          tx,
        );
      }

      if (dto.instructor && Object.keys(dto.instructor).length > 0) {
        const instProfile = await this.instructorProfileModel.findOne({
          where: { userId },
          transaction: tx,
        });

        if (!instProfile) {
          const created = await this.instructorProfileModel.create(
            {
              userId,
              displayName: dto.instructor.displayName || null,
            },
            { transaction: tx },
          );

          await this.roleService.assignRoleToUserByName(
            userId,
            'INSTRUCTOR',
            undefined,
            undefined,
            tx,
          );

          await created.update(dto.instructor, { transaction: tx });

          this.logger.log(
            `User ${userId} activated instructor profile via PATCH /profile/me`,
            'ProfileService',
          );
          results.instructor = created;
        } else {
          results.instructor = await this.updateInstructorProfile(
            userId,
            dto.instructor,
            tx,
          );
        }
      }

      this.logger.log(
        `Full profile updated for user ${userId} (sections: ${Object.keys(results).join(', ')})`,
        'ProfileService',
      );

      return results;
    });
  }

  // =====================================================
  // INSTRUCTOR DISCOVERY (public)
  // =====================================================

  /**
   * Discover public instructor profiles.
   *
   * Returns paginated list of instructors who have set isPublic=true.
   * City/country filters target `user` (the person's location) now,
   * not a duplicate on instructor_profile.
   */
  async discoverInstructors(dto: DiscoverInstructorsDto) {
    const where: Record<string | symbol, unknown> = {};
    // A coach whose account is closing (or switched off) is not listed.
    const userWhere: Record<string | symbol, unknown> = { isActive: true };

    if (dto.city) {
      userWhere.city = { [Op.iLike]: buildSearchTerm(dto.city) };
    }

    if (dto.country) {
      userWhere.countryCode = dto.country.toUpperCase();
    }

    if (dto.search) {
      const term = buildSearchTerm(dto.search);
      where[Op.or] = [
        { displayName: { [Op.iLike]: term } },
        { bio: { [Op.iLike]: term } },
        { '$user.first_name$': { [Op.iLike]: term } },
        { '$user.last_name$': { [Op.iLike]: term } },
        { '$user.city$': { [Op.iLike]: term } },
        literal(
          `CAST("InstructorProfile"."specializations" AS TEXT) ILIKE ${this.sequelize.escape(term)}`,
        ),
      ];
    }

    const profiles = await this.instructorProfileModel.findAll({
      where,
      include: [
        {
          model: User,
          attributes: USER_SAFE_ATTRIBUTES,
          where: userWhere,
          required: true,
        },
      ],
      subQuery: false,
      attributes: [
        'id',
        'userId',
        'displayName',
        'bio',
        'specializations',
        'yearsOfExperience',
        'isAcceptingClients',
        'socialLinks',
        'showSocialLinks',
      ],
      order: [['yearsOfExperience', 'DESC']],
      limit: 30,
    });

    return profiles.map((profile) => ({
      id: profile.id,
      userId: profile.userId,
      handle: profile.user?.handle ?? null,
      firstName: profile.user?.firstName,
      lastName: profile.user?.lastName,
      avatarId: profile.user?.avatarId,
      avatarUrl: profile.user?.avatarUrl ?? null,
      displayName: profile.displayName,
      bio: profile.bio,
      specializations: profile.specializations,
      yearsOfExperience: profile.yearsOfExperience,
      isAcceptingClients: profile.isAcceptingClients,
      city: profile.user?.city ?? null,
      countryCode: profile.user?.countryCode ?? null,
      socialLinks: profile.showSocialLinks ? profile.socialLinks : null,
    }));
  }

  /**
   * Get a public instructor profile by user ID.
   */
  async getInstructorPublicProfile(instructorUserId: string) {
    const profile = await this.instructorProfileModel.findOne({
      where: { userId: instructorUserId },
      include: [
        {
          model: User,
          // A closing (or switched off) account has no public page.
          where: { isActive: true },
          required: true,
          attributes: [...USER_SAFE_ATTRIBUTES, 'privacySettings'],
        },
      ],
    });

    if (!profile) {
      throw new NotFoundException(apiError('profile.coachNotFound'));
    }

    return this.toPublicProfileDto(profile);
  }

  /**
   * Get a public instructor profile by handle (case-insensitive).
   *
   * Mirrors `getInstructorPublicProfile` but resolves the profile by
   * its short URL slug — used by the `/@<handle>` page.
   */
  async getInstructorPublicProfileByHandle(handle: string) {
    const normalized = handle.trim().toLowerCase();
    if (!normalized) {
      throw new NotFoundException(apiError('profile.coachNotFound'));
    }

    // Handle lives on `user.handle`; the endpoint only resolves
    // instructor accounts, so we join through to instructor_profile.
    // Non-instructor handles fall through to
    // `/profile/users/by-handle/:handle` instead.
    const profile = await this.instructorProfileModel.findOne({
      include: [
        {
          model: User,
          required: true,
          where: {
            [Op.and]: [
              this.sequelize.where(
                this.sequelize.fn('LOWER', this.sequelize.col('user.handle')),
                normalized,
              ),
              // A closing (or switched off) account has no public page.
              { isActive: true },
            ],
          },
          attributes: [...USER_SAFE_ATTRIBUTES, 'privacySettings'],
        },
      ],
    });

    if (!profile) {
      throw new NotFoundException(apiError('profile.coachNotFound'));
    }

    return this.toPublicProfileDto(profile);
  }

  /**
   * Public groups owned by an instructor — feeds the Groups tab on
   * the Public Profile page. Delegates to GroupService so the actual
   * query lives next to other group lookups.
   */
  async getInstructorPublicGroups(instructorUserId: string) {
    return this.groupService.listPublicGroupsForInstructor(instructorUserId);
  }

  /**
   * Shared DTO shape for both `getInstructorPublicProfile` and the
   * by-handle lookup. Enriches the raw entity with rating summary
   * (from `ReviewService`) and surfaces `joinedAt` / `handle` for the
   * Public Profile screen.
   */
  private async toPublicProfileDto(profile: InstructorProfile) {
    const [rating, venues] = await Promise.all([
      this.reviewService.getSummaryForProfile(profile.id),
      this.venueService.listPublicForProfile(profile.id),
    ]);

    const settings = profile.user?.privacySettings ?? {};
    const maskField = <T>(field: PrivacyControlledField, value: T): T | null =>
      isFieldVisible(resolveLevel(settings, field), 'PUBLIC') ? value : null;

    return {
      id: profile.id,
      userId: profile.userId,
      handle: profile.user?.handle ?? null,
      firstName: profile.user?.firstName,
      lastName: profile.user?.lastName,
      avatarId: profile.user?.avatarId,
      avatarUrl: profile.user?.avatarUrl ?? null,
      displayName: profile.displayName,
      bio: profile.bio,
      specializations: profile.specializations,
      certifications: normalizeCertifications(profile.certifications),
      yearsOfExperience: profile.yearsOfExperience,
      isAcceptingClients: profile.isAcceptingClients,
      isPublic: profile.isPublic,
      email: maskField('email', profile.user?.email ?? null),
      phone: maskField('phone', profile.user?.phone ?? null),
      city: maskField('city', profile.user?.city ?? null),
      countryCode: maskField('city', profile.user?.countryCode ?? null),
      language: maskField('language', profile.user?.language ?? null),
      timezone: maskField('timezone', profile.user?.timezone ?? null),
      socialLinks: profile.showSocialLinks ? profile.socialLinks : null,
      showEmail: profile.showEmail,
      showPhone: profile.showPhone,
      joinedAt: profile.user?.createdAt ?? profile.createdAt,
      rating: rating.total === 0 ? null : rating,
      // Public, safe venue fields only — where the coach delivers, shown on
      // the profile's "Where I coach" section. No street address / meeting URL.
      venues: venues.map((v) => ({
        id: v.id,
        kind: v.kind,
        isOnline: v.isOnline,
        name: v.name,
        city: v.city,
        region: v.region,
        countryCode: v.countryCode,
      })),
    };
  }

  // =====================================================
  // PROFILE OVERVIEW
  // =====================================================

  /** Account + roles + instructor profile (if any). */
  async getProfileOverview(
    user: Pick<
      User,
      | 'id'
      | 'email'
      | 'firstName'
      | 'lastName'
      | 'phone'
      | 'avatarId'
      | 'avatarUrl'
      | 'language'
      | 'timezone'
      | 'isEmailVerified'
      | 'createdAt'
      | 'countryCode'
      | 'city'
    >,
  ) {
    // `req.user` from the JWT strategy doesn't include the new
    // `handle` / `privacySettings` columns, so re-read the row to keep
    // the overview shape correct for the FE (owner UI needs them to
    // render the privacy choosers and handle editor).
    const [instructorProfile, roles, full] = await Promise.all([
      this.getInstructorProfile(user.id),
      this.roleService.getUserRoles(user.id),
      User.findByPk(user.id, {
        attributes: ['handle', 'privacySettings'],
      }),
    ]);

    return {
      account: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone,
        avatarId: user.avatarId,
        avatarUrl: user.avatarUrl,
        language: user.language,
        timezone: user.timezone,
        isEmailVerified: user.isEmailVerified,
        createdAt: user.createdAt,
        countryCode: user.countryCode,
        city: user.city,
        handle: full?.handle ?? null,
        privacySettings: full?.privacySettings ?? {},
      },
      roles: roles.map((r) => r.name),
      hasInstructorProfile: !!instructorProfile,
      instructorProfile: instructorProfile
        ? {
            displayName: instructorProfile.displayName,
            bio: instructorProfile.bio,
            specializations: instructorProfile.specializations,
            certifications: instructorProfile.certifications,
            yearsOfExperience: instructorProfile.yearsOfExperience,
            isAcceptingClients: instructorProfile.isAcceptingClients,
            socialLinks: instructorProfile.socialLinks,
            showSocialLinks: instructorProfile.showSocialLinks,
          }
        : null,
    };
  }

  // =====================================================
  // PRIVACY & HANDLE (auth required)
  // =====================================================

  /**
   * Merge `dto` into the user's existing `privacy_settings`. The DTO
   * is partial, so single-field toggles ship a tiny payload — the
   * service does the read/merge/write under a transaction so two
   * concurrent toggles can't drop one of each other's keys.
   *
   * Returns the full merged settings object so the caller doesn't have
   * to re-fetch.
   */
  async updatePrivacySettings(
    userId: string,
    dto: UpdatePrivacySettingsDto,
  ): Promise<{ privacySettings: UserPrivacySettings }> {
    // class-validator strips unknown keys (whitelist), but the DTO is
    // still a plain object — strip undefined keys so we never overwrite
    // an existing entry with `undefined`.
    const patch: UserPrivacySettings = {};
    for (const [k, v] of Object.entries(dto)) {
      if (v !== undefined) {
        patch[k as PrivacyControlledField] = v as ProfilePrivacyLevel;
      }
    }
    if (Object.keys(patch).length === 0) {
      const current = await User.findByPk(userId, {
        attributes: ['privacySettings'],
      });
      if (!current) throw new NotFoundException(apiError('user.notFound'));
      return { privacySettings: current.privacySettings ?? {} };
    }

    return this.sequelize.transaction(async (tx) => {
      const user = await User.findByPk(userId, {
        attributes: ['id', 'privacySettings'],
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      });
      if (!user) throw new NotFoundException(apiError('user.notFound'));

      const merged: UserPrivacySettings = {
        ...(user.privacySettings ?? {}),
        ...patch,
      };
      // Sequelize doesn't dirty-track plain object mutations on JSONB
      // columns — assign a fresh object and persist explicitly.
      await user.update({ privacySettings: merged }, { transaction: tx });
      return { privacySettings: merged };
    });
  }

  /**
   * Claim a new handle for the authenticated user. Case-insensitive
   * uniqueness is enforced by the DB index; we still pre-check so the
   * caller gets a friendly 409 instead of a generic UniqueConstraint
   * error from a concurrent claim.
   */
  async updateHandle(
    userId: string,
    dto: UpdateHandleDto,
  ): Promise<{ handle: string }> {
    const normalized = dto.handle.trim().toLowerCase();

    return this.sequelize.transaction(async (tx) => {
      const conflict = await User.findOne({
        where: this.sequelize.where(
          this.sequelize.fn('LOWER', this.sequelize.col('handle')),
          normalized,
        ),
        attributes: ['id'],
        transaction: tx,
      });
      if (conflict && conflict.id !== userId) {
        throw new ConflictException(apiError('profile.handleTaken'));
      }

      const user = await User.findByPk(userId, { transaction: tx });
      if (!user) throw new NotFoundException(apiError('user.notFound'));

      try {
        await user.update({ handle: normalized }, { transaction: tx });
      } catch (err) {
        if (err instanceof UniqueConstraintError) {
          throw new ConflictException(apiError('profile.handleTaken'));
        }
        throw err;
      }

      return { handle: normalized };
    });
  }

  // =====================================================
  // PUBLIC USER PROFILE (works for any user, not just instructors)
  // =====================================================

  /**
   * `/@<handle>` for any user. Resolves the audience tier from the
   * caller's identity, applies per-field privacy, and includes the
   * `isInstructor` flag so the UI can decide whether to also fetch
   * the richer instructor public payload (offerings, reviews, …).
   */
  async getPublicUserProfileByHandle(handle: string, viewerId: string | null) {
    const normalized = handle.trim().toLowerCase();
    if (!normalized) {
      throw new NotFoundException(apiError('profile.notFound'));
    }

    const user = await User.findOne({
      where: {
        [Op.and]: [
          this.sequelize.where(
            this.sequelize.fn('LOWER', this.sequelize.col('handle')),
            normalized,
          ),
          // A closing (or switched off) account has no public page.
          { isActive: true },
        ],
      },
    });
    if (!user) {
      throw new NotFoundException(apiError('profile.notFound'));
    }

    const audience = await this.resolveAudience(viewerId, user.id);

    // Cheap parallel check — we want both the instructor flag (for the
    // FE branch) and the role list (for the public role badges).
    const [instructorProfile, roles, sharedGroups] = await Promise.all([
      this.instructorProfileModel.findOne({
        where: { userId: user.id },
        attributes: ['id'],
      }),
      this.roleService.getUserRoles(user.id),
      // Groups in common: only for a signed-in viewer looking at someone
      // else. A guest has none, and your own profile has nothing "in common".
      viewerId && audience !== 'OWNER'
        ? this.groupService.sharedGroups(viewerId, user.id)
        : Promise.resolve([]),
    ]);

    const settings = user.privacySettings ?? {};
    // This endpoint serves the *public* profile page. Owners viewing their
    // own profile should see it as the public would — not with all private
    // fields exposed. The owner identity is preserved in `audience` for the
    // frontend to show edit affordances; field values always use PUBLIC rules.
    const maskAudience: PublicProfileAudience =
      audience === 'OWNER' ? 'PUBLIC' : audience;
    const mask = <T>(field: PrivacyControlledField, value: T): T | null =>
      isFieldVisible(resolveLevel(settings, field), maskAudience)
        ? value
        : null;

    return {
      userId: user.id,
      handle: user.handle,
      audience,
      firstName: mask('firstName', user.firstName),
      lastName: mask('lastName', user.lastName),
      avatarUrl: mask('avatarUrl', user.avatarUrl),
      email: mask('email', user.email),
      phone: mask('phone', user.phone),
      city: mask('city', user.city),
      countryCode: mask('city', user.countryCode),
      language: mask('language', user.language),
      timezone: mask('timezone', user.timezone),
      displayRoles: roles
        .map((r) => r.name)
        .filter((name) => !HIDDEN_DISPLAY_ROLES.has(name)),
      memberSince: user.createdAt,
      isInstructor: !!instructorProfile,
      sharedGroups,
    };
  }

  /**
   * Owner > coach > public. Done as a single query when a viewer is
   * present so we don't pay two round-trips on the public-by-default
   * path.
   */
  private async resolveAudience(
    viewerId: string | null,
    ownerId: string,
  ): Promise<PublicProfileAudience> {
    if (!viewerId) return 'PUBLIC';
    if (viewerId === ownerId) return 'OWNER';

    const coachLink = await InstructorClient.findOne({
      where: {
        instructorId: viewerId,
        clientId: ownerId,
        status: InstructorClientStatus.ACTIVE,
      },
      attributes: ['id'],
    });
    return coachLink ? 'COACH' : 'PUBLIC';
  }
}

/**
 * Public shape of a single certification. The DB column is JSON and
 * historical data uses two different field conventions (the entity's
 * `{ issuingBody, issuedAt, expiresAt, credentialUrl }` and an older
 * UI-side `{ issuer, year }`). We accept either and emit a single,
 * stable shape so the FE doesn't have to branch.
 */
export interface PublicCertificationDto {
  name: string;
  issuer: string | null;
  year: number | null;
  credentialUrl: string | null;
}

interface RawCertification {
  name?: unknown;
  issuer?: unknown;
  issuingBody?: unknown;
  year?: unknown;
  issuedAt?: unknown;
  credentialUrl?: unknown;
}

function normalizeCertifications(raw: unknown): PublicCertificationDto[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item): PublicCertificationDto | null => {
      if (!item || typeof item !== 'object') return null;
      const c = item as RawCertification;
      const name = typeof c.name === 'string' ? c.name.trim() : '';
      if (!name) return null;

      const issuer =
        typeof c.issuer === 'string' && c.issuer.trim()
          ? c.issuer.trim()
          : typeof c.issuingBody === 'string' && c.issuingBody.trim()
            ? c.issuingBody.trim()
            : null;

      const credentialUrl =
        typeof c.credentialUrl === 'string' && c.credentialUrl.trim()
          ? c.credentialUrl.trim()
          : null;

      return {
        name,
        issuer,
        year: coerceYear(c.year ?? c.issuedAt),
        credentialUrl,
      };
    })
    .filter((c): c is PublicCertificationDto => c !== null);
}

function coerceYear(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.trunc(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Pure year like "2018"
    if (/^\d{4}$/.test(trimmed)) return Number(trimmed);
    // ISO date or anything Date() understands
    const date = new Date(trimmed);
    if (!Number.isNaN(date.getTime())) return date.getUTCFullYear();
  }
  return null;
}
