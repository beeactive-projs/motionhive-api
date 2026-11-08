import {
  Injectable,
  NotFoundException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import {
  Op,
  QueryTypes,
  Transaction,
  UniqueConstraintError,
  literal,
} from 'sequelize';
import type { Order, OrderItem } from 'sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { InstructorProfile } from './entities/instructor-profile.entity';
import { CreateInstructorProfileDto } from './dto/create-instructor-profile.dto';
import { UpdateInstructorProfileDto } from './dto/update-instructor-profile.dto';
import { UpdateFullProfileDto } from './dto/update-full-profile.dto';
import { DiscoverInstructorsDto } from './dto/discover-instructors.dto';
import { CoachDirectoryDto } from './dto/coach-directory.dto';
import { CoachDirectorySort } from './entities/coach-directory.enums';
import { SuggestedInstructorsDto } from './dto/suggested-instructors.dto';
import { CoachSuggestionReason } from './entities/coach-suggestion.enums';
import { UpdatePrivacySettingsDto } from './dto/update-privacy-settings.dto';
import { UpdateHandleDto } from './dto/update-handle.dto';
import type {
  ProfilePreviewAs,
  ProfileWorkoutsQueryDto,
} from './dto/profile-view-query.dto';
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
import {
  ClientRequest,
  ClientRequestStatus,
  ClientRequestType,
} from '../client/entities/client-request.entity';
import {
  foldedContains,
  normalizeSearchTerm,
} from '../../common/utils/search.utils';
import { buildPaginatedResponse } from '../../common/dto/pagination.dto';
import { apiError } from '../../common/i18n';
import { SearchIndexService } from '../search/search-index.service';
import { ReviewService } from '../review/review.service';
import { GroupService } from '../group/group.service';
import { VenueService } from '../venue/venue.service';
import { WorkoutLogService } from '../workout/workout-log.service';
import { WorkoutReportService } from '../workout/workout-report.service';
import { WorkoutPhotoService } from '../workout/workout-photo.service';
import { ReportWorkoutDto } from '../workout/dto/report-workout.dto';
import { WorkoutVisibility } from '../workout/entities/workout.enums';
import {
  categoryIdsSql,
  categoryRowsSql,
  hasAnyCategorySql,
} from '../category/category-sql';

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
 * Whether a coach coaches online: an active online venue (a meeting link)
 * on their profile. The apps' "Online" filter and badge both read it, so
 * it is the venue that decides, never a word in the specializations.
 * Written over the `InstructorProfile` alias the discovery queries use.
 */
const ONLINE_VENUE_SQL = `EXISTS (
  SELECT 1 FROM venue v
  WHERE v.instructor_id = "InstructorProfile"."id"
    AND v.is_online = true
    AND v.is_active = true
    AND v.deleted_at IS NULL
)`;

/** The coach's user id on a discovery row: coach categories are keyed by it. */
const COACH_USER_ID_SQL = '"InstructorProfile"."user_id"';

/**
 * The categories a coach coaches (migration 081), as a JSON array of ids in
 * the list's order.
 */
const COACH_CATEGORY_IDS_SQL = categoryIdsSql('coach', COACH_USER_ID_SQL);

/** A profile's specializations as rows; `[]` when the column holds no array. */
const SPECIALIZATIONS_SQL = `json_array_elements_text(
  CASE WHEN json_typeof("InstructorProfile"."specializations") = 'array'
    THEN "InstructorProfile"."specializations" ELSE '[]'::json END
)`;

/** The name a directory row shows, for sorting by it. */
const DIRECTORY_NAME_SQL = `lower(COALESCE(
  NULLIF(btrim("InstructorProfile"."display_name"), ''),
  concat_ws(' ', "user"."first_name", "user"."last_name")
))`;

/** How many cities and specializations the directory's filter sheet offers. */
const DIRECTORY_FACET_LIMIT = 40;

export interface CoachDirectoryFacet {
  label: string;
  count: number;
}

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
    private readonly workoutLogService: WorkoutLogService,
    private readonly workoutReportService: WorkoutReportService,
    private readonly workoutPhotoService: WorkoutPhotoService,
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
    transaction?: Transaction,
  ): Promise<InstructorProfile | null> {
    return this.instructorProfileModel.findOne({
      where: { userId: userId },
      transaction,
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
   * Discover instructor profiles: up to 30, the most experienced first, as
   * one plain array. `page` and `limit` are accepted but not applied; the
   * paged list is `coachDirectory`.
   *
   * `isPublic` is not checked: every active coach is listed, whatever they
   * picked. City/country filters target `user` (the person's location),
   * not a duplicate on instructor_profile.
   */
  async discoverInstructors(dto: DiscoverInstructorsDto) {
    const where: Record<string | symbol, unknown> = {};
    // A coach whose account is closing (or switched off) is not listed.
    const userWhere: Record<string | symbol, unknown> = { isActive: true };

    // Folded on both sides (`foldedContains`): "brasov" finds "Brașov" and
    // "stefan" finds "Ștefan". Folding only the typed term made accented
    // input miss accented names.
    const esc = (value: string) => this.sequelize.escape(value);

    if (dto.city) {
      userWhere[Op.and] = [foldedContains('"user"."city"', dto.city, esc)];
    }

    if (dto.country) {
      userWhere.countryCode = dto.country.toUpperCase();
    }

    if (dto.search) {
      const term = dto.search;
      where[Op.or] = [
        foldedContains('"InstructorProfile"."display_name"', term, esc),
        foldedContains('"InstructorProfile"."bio"', term, esc),
        foldedContains(
          `concat_ws(' ', "user"."first_name", "user"."last_name")`,
          term,
          esc,
        ),
        foldedContains('"user"."city"', term, esc),
        foldedContains(
          'CAST("InstructorProfile"."specializations" AS TEXT)',
          term,
          esc,
        ),
      ];
    }

    if (dto.categoryIds && dto.categoryIds.length > 0) {
      where[Op.and] = [literal(this.coachCategorySql(dto.categoryIds))];
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
        [literal(ONLINE_VENUE_SQL), 'isOnline'],
        [literal(COACH_CATEGORY_IDS_SQL), 'categoryIds'],
      ],
      order: [['yearsOfExperience', 'DESC']],
      limit: 30,
    });

    return profiles.map((profile) => this.toDirectoryRow(profile));
  }

  /**
   * The coach directory: the mobile Coaches screen's list, paged, with the
   * filters it offers. Open to guests; a signed-in viewer is left out of it,
   * along with anyone on either side of a block with them, so a page is
   * never short of the rows the app would have to drop.
   *
   * Coaches only (an admin can revoke the role and leave the profile
   * behind), and only active accounts. Like `discoverInstructors`,
   * `isPublic` is not checked yet.
   */
  async coachDirectory(viewerId: string | null, dto: CoachDirectoryDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;
    const esc = (value: string) => this.sequelize.escape(value);

    const userWhere: Record<string | symbol, unknown> = { isActive: true };
    if (dto.city) {
      userWhere[Op.and] = [foldedContains('"user"."city"', dto.city, esc)];
    }
    if (dto.country) {
      userWhere.countryCode = dto.country.toUpperCase();
    }

    const and = this.directoryScopeSql(viewerId).map((sql) => literal(sql));
    if (dto.online) {
      and.push(literal(ONLINE_VENUE_SQL));
    }
    if (dto.requested) {
      // A guest has asked nobody.
      and.push(literal(viewerId ? this.requestSentSql(viewerId) : 'false'));
    }
    if (dto.specializations?.length) {
      // Whole entries, folded on both sides: "forta" picks "Forță".
      const wanted = dto.specializations
        .map((value) => `fold_for_search(${esc(normalizeSearchTerm(value))})`)
        .join(', ');
      and.push(
        literal(`EXISTS (
          SELECT 1 FROM ${SPECIALIZATIONS_SQL} AS spec(value)
          WHERE fold_for_search(btrim(spec.value)) IN (${wanted})
        )`),
      );
    }

    if (dto.categoryIds && dto.categoryIds.length > 0) {
      and.push(literal(this.coachCategorySql(dto.categoryIds)));
    }

    const where: Record<string | symbol, unknown> = { [Op.and]: and };
    if (dto.accepting) {
      where.isAcceptingClients = true;
    }
    if (dto.minYears) {
      where.yearsOfExperience = { [Op.gte]: dto.minYears };
    }
    if (dto.search) {
      const term = dto.search;
      where[Op.or] = [
        foldedContains('"InstructorProfile"."display_name"', term, esc),
        foldedContains('"InstructorProfile"."bio"', term, esc),
        foldedContains(
          `concat_ws(' ', "user"."first_name", "user"."last_name")`,
          term,
          esc,
        ),
        foldedContains('"user"."city"', term, esc),
        foldedContains(
          'CAST("InstructorProfile"."specializations" AS TEXT)',
          term,
          esc,
        ),
      ];
    }

    const { rows, count } = await this.instructorProfileModel.findAndCountAll({
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
      distinct: true,
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
        [literal(ONLINE_VENUE_SQL), 'isOnline'],
        [literal(COACH_CATEGORY_IDS_SQL), 'categoryIds'],
        [
          literal(viewerId ? this.requestSentSql(viewerId) : 'false'),
          'requestSent',
        ],
      ],
      order: this.directoryOrder(dto.sort ?? CoachDirectorySort.RECOMMENDED),
      limit,
      offset: (page - 1) * limit,
    });

    return buildPaginatedResponse(
      rows.map((profile) => ({
        ...this.toDirectoryRow(profile),
        /** The viewer asked this coach and is still waiting on an answer. */
        requestSent: profile.getDataValue('requestSent' as never) === true,
      })),
      count,
      page,
      limit,
    );
  }

  /**
   * What the directory's filter sheet offers: the cities its coaches are in
   * and the specializations they list, each with how many coaches, the most
   * common first. Over the whole directory (the same coaches
   * `coachDirectory` lists before any filter), so a pick never depends on
   * which page happened to be loaded.
   *
   * Entries are grouped folded ("Forță" and "forta" are one), labelled with
   * the spelling most coaches use.
   */
  async coachDirectoryFacets(viewerId: string | null): Promise<{
    cities: CoachDirectoryFacet[];
    specializations: CoachDirectoryFacet[];
  }> {
    const scope = [
      '"InstructorProfile"."deleted_at" IS NULL',
      '"user"."deleted_at" IS NULL',
      '"user"."is_active" = true',
      ...this.directoryScopeSql(viewerId),
    ].join(' AND ');
    const from = `FROM instructor_profile AS "InstructorProfile"
      JOIN "user" AS "user" ON "user"."id" = "InstructorProfile"."user_id"`;

    const [cities, specializations] = await Promise.all([
      this.sequelize.query<CoachDirectoryFacet>(
        `SELECT mode() WITHIN GROUP (ORDER BY btrim("user"."city")) AS label,
                COUNT(*)::int AS count
         ${from}
         WHERE ${scope} AND btrim(COALESCE("user"."city", '')) <> ''
         GROUP BY fold_for_search(btrim("user"."city"))
         ORDER BY count DESC, label ASC
         LIMIT ${DIRECTORY_FACET_LIMIT}`,
        { type: QueryTypes.SELECT },
      ),
      this.sequelize.query<CoachDirectoryFacet>(
        `SELECT mode() WITHIN GROUP (ORDER BY btrim(spec.value)) AS label,
                COUNT(DISTINCT "InstructorProfile"."id")::int AS count
         ${from}
         CROSS JOIN LATERAL ${SPECIALIZATIONS_SQL} AS spec(value)
         WHERE ${scope} AND btrim(spec.value) <> ''
         GROUP BY fold_for_search(btrim(spec.value))
         ORDER BY count DESC, label ASC
         LIMIT ${DIRECTORY_FACET_LIMIT}`,
        { type: QueryTypes.SELECT },
      ),
    ]);

    return { cities, specializations };
  }

  /**
   * Who the directory and its facets count, as SQL over the
   * `InstructorProfile` alias: coaches only, and with a viewer, neither the
   * viewer nor anyone on either side of a block with them.
   */
  private directoryScopeSql(viewerId: string | null): string[] {
    const scope = [
      `EXISTS (
        SELECT 1 FROM user_role ur
        JOIN role r ON r.id = ur.role_id
        WHERE ur.user_id = "InstructorProfile"."user_id"
          AND r.name = 'INSTRUCTOR'
      )`,
    ];
    if (!viewerId) return scope;

    const viewer = this.sequelize.escape(viewerId);
    return [
      ...scope,
      `"InstructorProfile"."user_id" <> ${viewer}`,
      `NOT EXISTS (
        SELECT 1 FROM user_block ub
        WHERE (ub.blocker_id = ${viewer} AND ub.blocked_id = "InstructorProfile"."user_id")
           OR (ub.blocker_id = "InstructorProfile"."user_id" AND ub.blocked_id = ${viewer})
      )`,
    ];
  }

  /**
   * Whether the viewer asked this coach and the request is still waiting
   * (pending, not expired), as SQL over the `InstructorProfile` alias. The
   * same request the profile's `pendingRequest` reports with `sentByYou`, so
   * a directory row and the page it opens agree.
   */
  private requestSentSql(viewerId: string): string {
    const viewer = this.sequelize.escape(viewerId);
    return `EXISTS (
      SELECT 1 FROM client_request cr
      WHERE cr.from_user_id = ${viewer}
        AND cr.to_user_id = "InstructorProfile"."user_id"
        AND cr.status = '${ClientRequestStatus.PENDING}'
        AND cr.expires_at > now()
    )`;
  }

  /** Each order ends on the id, so paging never splits or repeats a tie. */
  private directoryOrder(sort: CoachDirectorySort): Order {
    const byName: OrderItem = [literal(DIRECTORY_NAME_SQL), 'ASC'];
    const byId: OrderItem = ['id', 'ASC'];
    switch (sort) {
      case CoachDirectorySort.EXPERIENCE:
        return [['yearsOfExperience', 'DESC NULLS LAST'], byName, byId];
      case CoachDirectorySort.NAME:
        return [byName, byId];
      case CoachDirectorySort.RECOMMENDED:
      default:
        return [
          ['isAcceptingClients', 'DESC'],
          ['yearsOfExperience', 'DESC NULLS LAST'],
          byName,
          byId,
        ];
    }
  }

  /**
   * Coaches who coach any of `ids`: the `categoryIds` filter of the discover
   * list and the directory alike.
   */
  private coachCategorySql(ids: readonly string[]): string {
    return hasAnyCategorySql('coach', COACH_USER_ID_SQL, ids, (value) =>
      this.sequelize.escape(value),
    );
  }

  /** The `categoryIds` literal of a coach row; `[]` when the query did not ask. */
  private categoryIdsOf(profile: InstructorProfile): string[] {
    const value: unknown = profile.getDataValue('categoryIds' as never);
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((id): id is string => typeof id === 'string');
  }

  /** One coach as the discover list and the directory both send it. */
  private toDirectoryRow(profile: InstructorProfile) {
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
      yearsOfExperience: profile.yearsOfExperience,
      isAcceptingClients: profile.isAcceptingClients,
      // A `literal` alias, so it is not a model attribute.
      isOnline: profile.getDataValue('isOnline' as never) === true,
      categoryIds: this.categoryIdsOf(profile),
      city: profile.user?.city ?? null,
      countryCode: profile.user?.countryCode ?? null,
      socialLinks: profile.showSocialLinks ? profile.socialLinks : null,
    };
  }

  /**
   * Coaches worth suggesting to one person: the "Suggested coaches" strips
   * in the apps (a new message, Home, Discover).
   *
   * Only users who hold the INSTRUCTOR role. Leaves out the viewer, coaches
   * they already have or have a pending request with, coaches not taking
   * clients, and anyone on either side of a block. Ranked by how many of
   * the viewer's interests the coach coaches, then same country, then those
   * with a photo, then by experience. Each row carries a `reason`; sponsored placements will join
   * this list under their own reason (see `CoachSuggestionReason`).
   */
  async suggestInstructors(viewerId: string, dto: SuggestedInstructorsDto) {
    const viewer = this.sequelize.escape(viewerId);

    const profiles = await this.instructorProfileModel.findAll({
      where: {
        isAcceptingClients: true,
        userId: { [Op.ne]: viewerId },
        [Op.and]: [
          // Coaches only: an admin can revoke the role and leave the profile behind.
          literal(`EXISTS (
            SELECT 1 FROM user_role ur
            JOIN role r ON r.id = ur.role_id
            WHERE ur.user_id = "InstructorProfile"."user_id"
              AND r.name = 'INSTRUCTOR'
          )`),
          literal(`NOT EXISTS (
            SELECT 1 FROM instructor_client ic
            WHERE ic.client_id = ${viewer}
              AND ic.instructor_id = "InstructorProfile"."user_id"
              AND ic.status IN ('${InstructorClientStatus.ACTIVE}', '${InstructorClientStatus.PENDING}')
          )`),
          literal(`NOT EXISTS (
            SELECT 1 FROM user_block ub
            WHERE (ub.blocker_id = ${viewer} AND ub.blocked_id = "InstructorProfile"."user_id")
               OR (ub.blocker_id = "InstructorProfile"."user_id" AND ub.blocked_id = ${viewer})
          )`),
        ],
      },
      include: [
        {
          model: User,
          attributes: USER_SAFE_ATTRIBUTES,
          // A coach whose account is closing (or switched off) is not suggested.
          where: { isActive: true },
          required: true,
        },
      ],
      subQuery: false,
      attributes: [
        'id',
        'userId',
        'displayName',
        'specializations',
        'yearsOfExperience',
        [literal(COACH_CATEGORY_IDS_SQL), 'categoryIds'],
      ],
      order: [
        // Coaches of what the viewer likes first, the most in common first.
        [
          literal(`(
            SELECT COUNT(*) FROM coach_category cc
            JOIN user_interest ui ON ui.category_id = cc.category_id
            WHERE cc.user_id = "InstructorProfile"."user_id"
              AND ui.user_id = ${viewer}
          )`),
          'DESC',
        ],
        [
          literal(
            `CASE WHEN "user"."country_code" = (SELECT country_code FROM "user" WHERE id = ${viewer}) THEN 0 ELSE 1 END`,
          ),
          'ASC',
        ],
        [
          literal(`CASE WHEN "user"."avatar_id" IS NULL THEN 1 ELSE 0 END`),
          'ASC',
        ],
        ['yearsOfExperience', 'DESC NULLS LAST'],
        ['createdAt', 'ASC'],
      ],
      limit: dto.limit ?? 10,
    });

    return profiles.map((profile) => ({
      id: profile.id,
      userId: profile.userId,
      handle: profile.user?.handle ?? null,
      firstName: profile.user?.firstName,
      lastName: profile.user?.lastName,
      avatarUrl: profile.user?.avatarUrl ?? null,
      displayName: profile.displayName,
      specializations: profile.specializations,
      categoryIds: this.categoryIdsOf(profile),
      yearsOfExperience: profile.yearsOfExperience,
      city: profile.user?.city ?? null,
      countryCode: profile.user?.countryCode ?? null,
      reason: CoachSuggestionReason.SUGGESTED,
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
    const [rating, venues, categories] = await Promise.all([
      this.reviewService.getSummaryForProfile(profile.id),
      this.venueService.listPublicForProfile(profile.id),
      this.sequelize.query<{ categoryId: string }>(
        categoryRowsSql('coach', ':userId', 'x.category_id AS "categoryId"'),
        { replacements: { userId: profile.userId }, type: QueryTypes.SELECT },
      ),
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
      /** What they coach, from the category list (`GET /categories`). */
      categoryIds: categories.map((row) => row.categoryId),
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
            allowClientMentions: instructorProfile.allowClientMentions,
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
  async getPublicUserProfileByHandle(
    handle: string,
    viewerId: string | null,
    previewAs?: ProfilePreviewAs,
  ) {
    const user = await this._activeUserByHandle(handle);
    const { audience, yourCoachSince } = await this._relationship(
      viewerId,
      user.id,
    );
    const seenAs = this._seenAs(audience, previewAs);

    // Cheap parallel check — we want both the instructor flag (for the
    // FE branch) and the role list (for the public role badges).
    const [
      instructorProfile,
      roles,
      sharedGroups,
      workoutCount,
      pendingRequest,
    ] = await Promise.all([
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
      this.workoutLogService.countForProfile(
        user.id,
        this._workoutLevels(seenAs),
      ),
      viewerId && audience !== 'OWNER'
        ? this._pendingRequest(viewerId, user.id)
        : Promise.resolve(null),
    ]);

    const settings = user.privacySettings ?? {};
    // This endpoint serves the *public* profile page. Owners viewing their
    // own profile see it as the public would (or as their coaches would,
    // when previewing that), never with every private field exposed. The
    // owner identity is preserved in `audience` for the edit affordances.
    const mask = <T>(field: PrivacyControlledField, value: T): T | null =>
      isFieldVisible(resolveLevel(settings, field), seenAs) ? value : null;

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
      /** Workouts this viewer may see; the section is left out at 0. */
      workoutCount,
      /** When they became the viewer's coach; null unless they are now. */
      yourCoachSince,
      /** A coaching request between the two still waiting; null when none. */
      pendingRequest,
    };
  }

  /**
   * The workouts a profile shows, newest first, as safe summaries
   * (`WorkoutLogService.listForProfile`). The same audience rule as the
   * profile's fields.
   */
  async getPublicUserWorkouts(
    handle: string,
    viewerId: string | null,
    query: ProfileWorkoutsQueryDto,
  ) {
    const user = await this._activeUserByHandle(handle);
    const { audience } = await this._relationship(viewerId, user.id);
    const { previewAs, ...page } = query;
    return this.workoutLogService.listForProfile(
      user.id,
      this._workoutLevels(this._seenAs(audience, previewAs)),
      page,
    );
  }

  /**
   * One workout on a profile, as its card there shows it. A workout the
   * viewer cannot see on that profile is a 404, the same as one that
   * does not exist.
   */
  async getPublicUserWorkout(
    handle: string,
    viewerId: string | null,
    workoutLogId: string,
    previewAs?: ProfilePreviewAs,
  ) {
    const user = await this._activeUserByHandle(handle);
    const { audience } = await this._relationship(viewerId, user.id);
    return this.workoutLogService.findForProfile(
      user.id,
      this._workoutLevels(this._seenAs(audience, previewAs)),
      workoutLogId,
    );
  }

  /**
   * The photo of one workout on a profile, under the same rule as the
   * workout itself: whoever may see the workout there sees its photo, and
   * anyone else gets a 404.
   */
  async getPublicUserWorkoutPhoto(
    handle: string,
    viewerId: string | null,
    workoutLogId: string,
    previewAs?: ProfilePreviewAs,
  ): Promise<Buffer> {
    const user = await this._activeUserByHandle(handle);
    const { audience } = await this._relationship(viewerId, user.id);
    return this.workoutPhotoService.photoForProfile(
      user.id,
      this._workoutLevels(this._seenAs(audience, previewAs)),
      workoutLogId,
    );
  }

  /**
   * Report a workout on this profile. Only one the reporter can see there
   * (the section's own levels), so a report never confirms that a hidden
   * workout exists.
   */
  async reportUserWorkout(
    handle: string,
    reporterId: string,
    workoutLogId: string,
    dto: ReportWorkoutDto,
  ) {
    const user = await this._activeUserByHandle(handle);
    const { audience } = await this._relationship(reporterId, user.id);
    return this.workoutReportService.submit({
      reporterId,
      ownerId: user.id,
      workoutLogId,
      levels: this._workoutLevels(this._seenAs(audience)),
      category: dto.category,
      notes: dto.notes,
    });
  }

  /**
   * Whose eyes a profile is shown through. The owner sees their page as
   * the public would, so what they see is what others see, or as their
   * coaches would when previewing that. Nobody else can borrow a view.
   */
  private _seenAs(
    audience: PublicProfileAudience,
    previewAs?: ProfilePreviewAs,
  ): ProfilePreviewAs {
    if (audience !== 'OWNER') return audience;
    return previewAs === 'COACH' ? 'COACH' : 'PUBLIC';
  }

  /**
   * Which workout levels a profile shows: Public ones to everyone, and
   * Coaches only as well to an active coach.
   */
  private _workoutLevels(seenAs: ProfilePreviewAs): WorkoutVisibility[] {
    return seenAs === 'COACH'
      ? [WorkoutVisibility.Public, WorkoutVisibility.CoachesOnly]
      : [WorkoutVisibility.Public];
  }

  /** The person behind a handle, or 404: a closing account has no page. */
  private async _activeUserByHandle(handle: string): Promise<User> {
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
    return user;
  }

  /**
   * A coaching request between the viewer and the owner that is still
   * waiting (pending, not expired), in either direction, newest first. A
   * profile reads it to offer the right verb: a trainee who asked a coach
   * sees "Request sent", one the coach invited sees "Accept". Any pending
   * request blocks a new one (`ClientService.assertNoPendingRequest`), so the
   * page must know about it to avoid offering a request that would fail.
   */
  private async _pendingRequest(
    viewerId: string,
    ownerId: string,
  ): Promise<{
    id: string;
    type: ClientRequestType;
    sentByYou: boolean;
    createdAt: Date;
    expiresAt: Date;
  } | null> {
    const request = await ClientRequest.findOne({
      where: {
        status: ClientRequestStatus.PENDING,
        expiresAt: { [Op.gt]: new Date() },
        [Op.or]: [
          { fromUserId: viewerId, toUserId: ownerId },
          { fromUserId: ownerId, toUserId: viewerId },
        ],
      },
      attributes: ['id', 'type', 'fromUserId', 'createdAt', 'expiresAt'],
      order: [['createdAt', 'DESC']],
    });
    if (!request) return null;
    return {
      id: request.id,
      type: request.type,
      sentByYou: request.fromUserId === viewerId,
      createdAt: request.createdAt,
      expiresAt: request.expiresAt,
    };
  }

  /**
   * How the viewer stands to the owner, both ways, in one query: owner >
   * coach > public for what they see, and since when the owner has been
   * the viewer's coach. No query at all for a guest or the owner.
   */
  private async _relationship(
    viewerId: string | null,
    ownerId: string,
  ): Promise<{
    audience: PublicProfileAudience;
    yourCoachSince: Date | null;
  }> {
    if (!viewerId) return { audience: 'PUBLIC', yourCoachSince: null };
    if (viewerId === ownerId)
      return { audience: 'OWNER', yourCoachSince: null };

    const links = await InstructorClient.findAll({
      where: {
        status: InstructorClientStatus.ACTIVE,
        [Op.or]: [
          { instructorId: viewerId, clientId: ownerId },
          { instructorId: ownerId, clientId: viewerId },
        ],
      },
      attributes: ['instructorId', 'startedAt', 'createdAt'],
    });
    const coachesOwner = links.some((link) => link.instructorId === viewerId);
    const coachedByOwner = links.find((link) => link.instructorId === ownerId);
    return {
      audience: coachesOwner ? 'COACH' : 'PUBLIC',
      // An active row from before `started_at` was stamped on accept
      // still says since when it has stood.
      yourCoachSince: coachedByOwner
        ? (coachedByOwner.startedAt ?? coachedByOwner.createdAt)
        : null,
    };
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
