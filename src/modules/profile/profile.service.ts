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
import { UserProfile } from './entities/user-profile.entity';
import { InstructorProfile } from './entities/instructor-profile.entity';
import { UpdateUserProfileDto } from './dto/update-user-profile.dto';
import { CreateInstructorProfileDto } from './dto/create-instructor-profile.dto';
import { UpdateInstructorProfileDto } from './dto/update-instructor-profile.dto';
import { UpdateFullProfileDto } from './dto/update-full-profile.dto';
import { DiscoverInstructorsDto } from './dto/discover-instructors.dto';
import { RoleService } from '../role/role.service';
import { UserService } from '../user/user.service';
import { User } from '../user/entities/user.entity';
import { buildSearchTerm } from '../../common/utils/search.utils';

/**
 * Profile Service
 *
 * Manages user and instructor profiles.
 *
 * Key concepts:
 * - User profile is created automatically at registration
 * - Instructor profile is created when user activates "instruct activities"
 * - A user can have BOTH profiles (instructor who also joins other classes)
 */
@Injectable()
export class ProfileService {
  constructor(
    @InjectModel(UserProfile)
    private userProfileModel: typeof UserProfile,
    @InjectModel(InstructorProfile)
    private instructorProfileModel: typeof InstructorProfile,
    private sequelize: Sequelize,
    private roleService: RoleService,
    private userService: UserService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // =====================================================
  // USER PROFILE
  // =====================================================

  /**
   * Create empty user profile (called during registration)
   */
  async createUserProfile(
    userId: string,
    transaction?: Transaction,
  ): Promise<UserProfile> {
    return this.userProfileModel.create({ userId: userId }, { transaction });
  }

  /**
   * Get user profile for the authenticated user
   */
  async getUserProfile(userId: string): Promise<UserProfile | null> {
    return this.userProfileModel.findOne({
      where: { userId: userId },
    });
  }

  /**
   * Update user profile
   *
   * All fields are optional — user fills them progressively.
   */
  async updateUserProfile(
    userId: string,
    dto: UpdateUserProfileDto,
  ): Promise<UserProfile> {
    const profile = await this.userProfileModel.findOne({
      where: { userId: userId },
    });

    if (!profile) {
      throw new NotFoundException('User profile not found');
    }

    await profile.update(dto);
    return profile;
  }

  // =====================================================
  // INSTRUCTOR PROFILE
  // =====================================================

  /**
   * Create an instructor profile within an existing transaction.
   *
   * Used during registration when isInstructor=true, so the entire
   * registration (user + user profile + instructor profile + roles) is
   * atomic. The caller owns the transaction commit/rollback.
   *
   * @param userId - The newly created user's UUID
   * @param firstName - Used as displayName fallback
   * @param lastName - Used as displayName fallback
   * @param transaction - The outer transaction to join
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
        locationCity: null,
        locationCountry: null,
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
    // Check if already has instructor profile
    const existing = await this.instructorProfileModel.findOne({
      where: { userId: userId },
    });

    if (existing) {
      throw new ConflictException('Instructor profile already exists');
    }

    // Wrap in transaction: create profile + assign role must both succeed
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
          locationCity: dto.locationCity ?? null,
          locationCountry: dto.locationCountry ?? null,
        },
        { transaction },
      );

      // Assign INSTRUCTOR role (global, not group-scoped yet)
      await this.roleService.assignRoleToUserByName(
        userId,
        'INSTRUCTOR',
        undefined,
        undefined,
        transaction,
      );

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

  /**
   * Get instructor profile for the authenticated user
   */
  async getInstructorProfile(
    userId: string,
  ): Promise<InstructorProfile | null> {
    return this.instructorProfileModel.findOne({
      where: { userId: userId },
    });
  }

  /**
   * Update instructor profile
   */
  async updateInstructorProfile(
    userId: string,
    dto: UpdateInstructorProfileDto,
  ): Promise<InstructorProfile> {
    const profile = await this.instructorProfileModel.findOne({
      where: { userId: userId },
    });

    if (!profile) {
      throw new NotFoundException(
        'Instructor profile not found. Activate it first via PATCH /profile/me (with { instructor: {...} }) or POST /profile/instructor',
      );
    }

    await profile.update(dto);
    return profile;
  }

  // =====================================================
  // UNIFIED PROFILE UPDATE
  // =====================================================

  /**
   * Update full profile (user + user profile + instructor) in one call
   *
   * Only provided sections are updated. If a section is omitted, it's skipped.
   */
  async updateFullProfile(userId: string, dto: UpdateFullProfileDto) {
    const results: {
      account?: User;
      fitnessProfile?: UserProfile;
      instructor?: InstructorProfile;
    } = {};

    // Update core user fields
    if (dto.account && Object.keys(dto.account).length > 0) {
      results.account = await this.userService.updateUser(userId, dto.account);
    }

    // Update user profile
    if (dto.fitnessProfile && Object.keys(dto.fitnessProfile).length > 0) {
      results.fitnessProfile = await this.updateUserProfile(
        userId,
        dto.fitnessProfile,
      );
    }

    // Update instructor profile
    // If instructor profile doesn't exist yet, treat this as "become an instructor"
    if (dto.instructor && Object.keys(dto.instructor).length > 0) {
      const instProfile = await this.getInstructorProfile(userId);
      if (!instProfile) {
        const transaction = await this.sequelize.transaction();
        try {
          const created = await this.instructorProfileModel.create(
            {
              userId: userId,
              displayName: dto.instructor.displayName || null,
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

          // Apply the instructor fields in the same transaction
          await created.update(dto.instructor, { transaction });

          await transaction.commit();

          this.logger.log(
            `User ${userId} activated instructor profile via PATCH /profile/me`,
            'ProfileService',
          );

          results.instructor = created;
        } catch (error) {
          await transaction.rollback();
          throw error;
        }
      } else {
        results.instructor = await this.updateInstructorProfile(
          userId,
          dto.instructor,
        );
      }
    }

    this.logger.log(
      `Full profile updated for user ${userId} (sections: ${Object.keys(results).join(', ')})`,
      'ProfileService',
    );

    return results;
  }

  // =====================================================
  // INSTRUCTOR DISCOVERY (public)
  // =====================================================

  /**
   * Discover public instructor profiles
   *
   * Returns paginated list of instructors who have set isPublic=true.
   * Supports search by name/bio/specialization and filtering by city/country.
   * Sorted by years of experience (most experienced first).
   */
  async discoverInstructors(dto: DiscoverInstructorsDto) {
    const where: Record<string | symbol, unknown> = {};

    if (dto.city) {
      where.locationCity = { [Op.iLike]: buildSearchTerm(dto.city) };
    }

    if (dto.country) {
      where.locationCountry = dto.country;
    }

    // Search across name, profile, specializations and location
    if (dto.search) {
      const term = buildSearchTerm(dto.search);
      where[Op.or] = [
        { displayName: { [Op.iLike]: term } },
        { bio: { [Op.iLike]: term } },
        { locationCity: { [Op.iLike]: term } },
        { '$user.first_name$': { [Op.iLike]: term } },
        { '$user.last_name$': { [Op.iLike]: term } },
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
          attributes: ['id', 'firstName', 'lastName', 'avatarId'],
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
        'locationCity',
        'locationCountry',
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
      city: profile.locationCity,
      country: profile.locationCountry,
      socialLinks: profile.showSocialLinks ? profile.socialLinks : null,
    }));
  }

  /**
   * Get a public instructor profile by user ID
   *
   * Returns the instructor's public profile if isPublic is true.
   * Used when a user clicks on an instructor from the discover list.
   */
  async getInstructorPublicProfile(instructorUserId: string) {
    const profile = await this.instructorProfileModel.findOne({
      where: { userId: instructorUserId },
      include: [
        {
          model: User,
          attributes: ['id', 'firstName', 'lastName', 'avatarId'],
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
      city: profile.locationCity,
      country: profile.locationCountry,
      socialLinks: profile.showSocialLinks ? profile.socialLinks : null,
      showEmail: profile.showEmail,
      showPhone: profile.showPhone,
    };
  }

  // =====================================================
  // PROFILE OVERVIEW
  // =====================================================

  /**
   * Get complete profile overview
   *
   * Returns user data, roles, and both profiles.
   * The frontend uses this to know what UI to show.
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
    >,
  ) {
    const [userProfile, instructorProfile, roles] = await Promise.all([
      this.getUserProfile(user.id),
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
      },
      roles: roles.map((r) => r.name),
      hasInstructorProfile: !!instructorProfile,
      fitnessProfile: userProfile
        ? {
            dateOfBirth: userProfile.dateOfBirth,
            gender: userProfile.gender,
            heightCm: userProfile.heightCm,
            weightKg: userProfile.weightKg,
            fitnessLevel: userProfile.fitnessLevel,
            goals: userProfile.goals ?? [],
            medicalConditions: userProfile.medicalConditions ?? [],
            emergencyContactName: userProfile.emergencyContactName,
            emergencyContactPhone: userProfile.emergencyContactPhone,
            notes: userProfile.notes,
          }
        : null,
      instructorProfile: instructorProfile
        ? {
            displayName: instructorProfile.displayName,
            bio: instructorProfile.bio,
            specializations: instructorProfile.specializations,
            certifications: instructorProfile.certifications,
            yearsOfExperience: instructorProfile.yearsOfExperience,
            isAcceptingClients: instructorProfile.isAcceptingClients,
            socialLinks: instructorProfile.socialLinks,
            locationCity: instructorProfile.locationCity,
            locationCountry: instructorProfile.locationCountry,
          }
        : null,
    };
  }
}
