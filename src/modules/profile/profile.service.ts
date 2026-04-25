import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op, Transaction, literal } from 'sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { InstructorProfile } from './entities/instructor-profile.entity';
import { CreateInstructorProfileDto } from './dto/create-instructor-profile.dto';
import { UpdateInstructorProfileDto } from './dto/update-instructor-profile.dto';
import { UpdateFullProfileDto } from './dto/update-full-profile.dto';
import { DiscoverInstructorsDto } from './dto/discover-instructors.dto';
import { RoleService } from '../role/role.service';
import { UserService } from '../user/user.service';
import { User } from '../user/entities/user.entity';
import { buildSearchTerm } from '../../common/utils/search.utils';
import { SearchIndexService } from '../search/search-index.service';

/**
 * Profile Service
 *
 * Manages the instructor profile; the person's identity (name, email,
 * country, city) lives on `user`. Prior to migration 027 this module
 * also owned a `user_profile` table with health/fitness data, but no
 * UI consumed it and it has been dropped.
 *
 * Instructor location comes from `user.countryCode` / `user.city` now,
 * not a duplicate on `instructor_profile`. Discovery queries therefore
 * JOIN through the user row.
 */
@Injectable()
export class ProfileService {
  constructor(
    @InjectModel(InstructorProfile)
    private instructorProfileModel: typeof InstructorProfile,
    private sequelize: Sequelize,
    private roleService: RoleService,
    private userService: UserService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    private readonly searchIndexService: SearchIndexService,
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
      throw new ConflictException('Instructor profile already exists');
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
      throw new NotFoundException(
        'Instructor profile not found. Activate it first via PATCH /profile/me (with { instructor: {...} }) or POST /profile/instructor',
      );
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
    const userWhere: Record<string | symbol, unknown> = {};

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
          attributes: [
            'id',
            'firstName',
            'lastName',
            'avatarId',
            'city',
            'countryCode',
          ],
          where: Object.keys(userWhere).length ? userWhere : undefined,
          required: Object.keys(userWhere).length > 0,
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
      firstName: profile.user?.firstName,
      lastName: profile.user?.lastName,
      avatarId: profile.user?.avatarId,
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
          attributes: [
            'id',
            'firstName',
            'lastName',
            'avatarId',
            'city',
            'countryCode',
          ],
        },
      ],
    });

    if (!profile) {
      throw new NotFoundException(
        'Instructor profile not found or is not public',
      );
    }

    return {
      id: profile.id,
      userId: profile.userId,
      firstName: profile.user?.firstName,
      lastName: profile.user?.lastName,
      avatarId: profile.user?.avatarId,
      displayName: profile.displayName,
      bio: profile.bio,
      specializations: profile.specializations,
      certifications: profile.certifications,
      yearsOfExperience: profile.yearsOfExperience,
      isAcceptingClients: profile.isAcceptingClients,
      city: profile.user?.city ?? null,
      countryCode: profile.user?.countryCode ?? null,
      socialLinks: profile.showSocialLinks ? profile.socialLinks : null,
      showEmail: profile.showEmail,
      showPhone: profile.showPhone,
    };
  }

  // =====================================================
  // PROFILE OVERVIEW
  // =====================================================

  /**
   * Get complete profile overview.
   *
   * Returns the account + roles + instructor profile (if any). The
   * historical `fitnessProfile` section is gone — see migration 027.
   */
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
    const [instructorProfile, roles] = await Promise.all([
      this.getInstructorProfile(user.id),
      this.roleService.getUserRoles(user.id),
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
          }
        : null,
    };
  }
}
