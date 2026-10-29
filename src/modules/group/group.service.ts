import type { LoggerService } from '@nestjs/common';
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op, Transaction, WhereOptions, literal } from 'sequelize';
import { buildPaginatedResponse } from '../../common/dto/pagination.dto';
import { CryptoService } from '../../common/services/crypto.service';
import { EmailService } from '../../common/services/email.service';
import { buildSearchTerm } from '../../common/utils/search.utils';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import { NotificationService } from '../notification/notification.service';
import {
  groupMemberLeft,
  groupMemberRemoved,
  groupJoinRequestReceived,
  groupJoinRequestApproved,
  groupJoinRequestRejected,
  groupOwnershipTransferredToNewOwner,
  groupOwnershipTransferredFromOldOwner,
  groupMemberRoleChanged,
} from './notifications';
import {
  InstructorProfile,
  type SocialLinks,
} from '../profile/entities/instructor-profile.entity';
import { SearchIndexService } from '../search/search-index.service';
import { SessionInstance } from '../session/entities/session-instance.entity';
import { SessionTemplate } from '../session/entities/session-template.entity';
import {
  SessionAccess,
  SessionInstanceStatus,
} from '../session/entities/session.enums';
import { User, USER_SAFE_ATTRIBUTES } from '../user/entities/user.entity';
import {
  isFieldVisible,
  resolveLevel,
  type PublicProfileAudience,
} from '../profile/profile-privacy';
import { CreateGroupDto } from './dto/create-group.dto';
import { DiscoverGroupsDto } from './dto/discover-groups.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import {
  AssignableMemberRole,
  UpdateMemberRoleDto,
} from './dto/update-member-role.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { GroupMember, GroupMemberRole } from './entities/group-member.entity';
import {
  GroupJoinRequest,
  GroupJoinRequestStatus,
} from './entities/group-join-request.entity';
import { Group, JoinPolicy, MemberPostPolicy } from './entities/group.entity';
import {
  DecideJoinRequestDto,
  JoinRequestDecision,
} from './dto/decide-join-request.dto';
import { apiError, toLocale } from '../../common/i18n';

/**
 * Group Service
 *
 * Manages groups (fitness groups, training crews, teams).
 *
 * Key flows:
 * - Instructor creates group -> becomes owner member
 * - Members join via invitations, join links, OR self-join (if joinPolicy = OPEN)
 * - Public groups appear in discovery search
 * - Members can share/hide their health data per-group
 * - getMembers checks instructor_client table to flag which members are clients
 */

/** Public-facing instructor card rendered inside the group detail view.
 *  Scalar summary of what `InstructorProfile` + `User` expose publicly. */
export interface PublicInstructorProfile {
  userId: string;
  firstName: string;
  lastName: string;
  avatarId: number | null;
  displayName?: string | null;
  bio?: string | null;
  specializations?: string[] | null;
  yearsOfExperience?: number | null;
  isAcceptingClients?: boolean;
  socialLinks?: SocialLinks | null;
}

/** Result returned by `selfJoinGroup`. Branches on group's joinPolicy. */
export interface SelfJoinResult {
  status: 'JOINED' | 'PENDING';
  member?: GroupMember;
  request?: GroupJoinRequest;
}

@Injectable()
export class GroupService {
  constructor(
    @InjectModel(Group)
    private readonly groupModel: typeof Group,
    @InjectModel(GroupMember)
    private readonly memberModel: typeof GroupMember,
    @InjectModel(GroupJoinRequest)
    private readonly joinRequestModel: typeof GroupJoinRequest,
    @InjectModel(InstructorClient)
    private readonly instructorClientModel: typeof InstructorClient,
    @InjectModel(User)
    private readonly userModel: typeof User,
    private readonly emailService: EmailService,
    private readonly cryptoService: CryptoService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
    private readonly searchIndexService: SearchIndexService,
    private readonly notificationService: NotificationService,
  ) {}

  // =====================================================
  // SLUG GENERATION
  // =====================================================

  /**
   * Generate URL-friendly slug from group name
   *
   * Handles Unicode/diacritics properly:
   * - "Sala de Fitness" -> "sala-de-fitness"
   * - "Cafe Resume" -> "cafe-resume"
   */
  private generateSlug(name: string): string {
    return name
      .normalize('NFD') // Decompose diacritics (a with breve -> a + combining mark)
      .replace(/[\u0300-\u036f]/g, '') // Remove combining marks
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // Remove remaining non-alphanumeric
      .replace(/\s+/g, '-') // Spaces to hyphens
      .replace(/-+/g, '-') // Collapse multiple hyphens
      .replace(/^-|-$/g, '') // Trim leading/trailing hyphens
      .substring(0, 100);
  }

  /**
   * Ensure slug is unique by appending a number if needed.
   * Accepts optional transaction to participate in caller's transaction.
   */
  private async ensureUniqueSlug(
    baseSlug: string,
    transaction?: Transaction,
  ): Promise<string> {
    let slug = baseSlug;
    let counter = 1;

    while (
      await this.groupModel.findOne({
        where: { slug },
        ...(transaction ? { transaction } : {}),
      })
    ) {
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    return slug;
  }

  // =====================================================
  // GROUP CRUD
  // =====================================================

  /**
   * Create a new group
   *
   * Only users with INSTRUCTOR role can create groups.
   * The creator becomes the owner member.
   * Uses a transaction to ensure atomicity of group + member creation.
   */
  async create(userId: string, dto: CreateGroupDto): Promise<Group> {
    const baseSlug = this.generateSlug(dto.name);
    const MAX_SLUG_RETRIES = 3;

    for (let attempt = 0; attempt <= MAX_SLUG_RETRIES; attempt++) {
      const sequelize = this.groupModel.sequelize!;
      const transaction = await sequelize.transaction();

      try {
        // Generate slug inside transaction to reduce race window
        const slug = await this.ensureUniqueSlug(baseSlug, transaction);

        const group = await this.groupModel.create(
          {
            instructorId: userId,
            name: dto.name,
            slug,
            description: dto.description,
            timezone: dto.timezone || 'Europe/Bucharest',
            isPublic: dto.isPublic || false,
            joinPolicy: dto.joinPolicy || JoinPolicy.INVITE_ONLY,
            memberPostPolicy: dto.memberPostPolicy || MemberPostPolicy.DISABLED,
            tags: dto.tags,
            contactEmail: dto.contactEmail,
            contactPhone: dto.contactPhone,
            address: dto.address,
            city: dto.city,
            country: dto.country,
          },
          { transaction },
        );

        // Add creator as owner member
        await this.memberModel.create(
          {
            groupId: group.id,
            userId: userId,
            role: GroupMemberRole.OWNER,
          },
          { transaction },
        );

        await transaction.commit();

        // After commit so a search-index failure can't roll back the
        // user-visible group create.
        await this.searchIndexService.upsertGroup(group.id);

        this.logger.log(
          `Group created: ${group.name} (${group.id}) by instructor ${userId}`,
          'GroupService',
        );

        return group;
      } catch (error: unknown) {
        await transaction.rollback();

        // Retry on unique constraint violation (slug collision from concurrent create).
        // Sequelize's typed error has `.name` + `.fields`; narrow to the shape we use.
        const isUniqueViolation =
          error instanceof Error &&
          error.name === 'SequelizeUniqueConstraintError' &&
          (error as Error & { fields?: Record<string, unknown> }).fields
            ?.slug !== undefined;

        if (isUniqueViolation && attempt < MAX_SLUG_RETRIES) {
          this.logger.warn(
            `Slug collision for "${baseSlug}", retrying (attempt ${attempt + 1})`,
            'GroupService',
          );
          continue;
        }

        throw error;
      }
    }

    // Should never reach here, but TypeScript needs it
    throw new BadRequestException(apiError('group.createFailed'));
  }

  /**
   * Get all groups the user belongs to (active memberships only), each with
   * the user's role in it: whether they may post somewhere depends on it
   * (staff always may), and the membership rows are loaded here anyway.
   */
  async getMyGroups(
    userId: string,
  ): Promise<Array<Group & { myRole: GroupMemberRole }>> {
    const memberships = await this.memberModel.findAll({
      where: { userId, leftAt: null },
      attributes: ['groupId', 'role'],
    });

    const roleByGroup = new Map(memberships.map((m) => [m.groupId, m.role]));
    const groupIds = [...roleByGroup.keys()];
    if (groupIds.length === 0) return [];

    const memberCountLiteral = literal(
      '(SELECT COUNT(*)::int FROM group_member WHERE group_member.group_id = "Group"."id" AND group_member.left_at IS NULL)',
    );

    const groups = await this.groupModel.findAll({
      where: { id: { [Op.in]: groupIds }, isActive: true },
      attributes: {
        include: [[memberCountLiteral, 'memberCount']],
      },
    });
    // Plain rows: an instance drops an added property when serialised.
    return groups.map((group) => {
      const plain = group.get({ plain: true }) as Group & {
        myRole: GroupMemberRole;
      };
      plain.myRole = roleByGroup.get(group.id) ?? GroupMemberRole.MEMBER;
      return plain;
    });
  }
  /**
   * Groups two people are both active members of — "groups in common" on a
   * profile. Owners hold a membership row, so a coach's own groups count.
   * Nothing here is news to the viewer: they are a member of every group it
   * returns and can already see who else is in it.
   */
  async sharedGroups(
    viewerId: string,
    otherUserId: string,
    limit = 10,
  ): Promise<{ id: string; name: string; logoUrl: string | null }[]> {
    const mine = await this.memberModel.findAll({
      where: { userId: viewerId, leftAt: null },
      attributes: ['groupId'],
    });
    if (mine.length === 0) return [];

    const theirs = await this.memberModel.findAll({
      where: {
        userId: otherUserId,
        leftAt: null,
        groupId: { [Op.in]: mine.map((m) => m.groupId) },
      },
      attributes: ['groupId'],
    });
    if (theirs.length === 0) return [];

    const groups = await this.groupModel.findAll({
      where: { id: { [Op.in]: theirs.map((m) => m.groupId) }, isActive: true },
      attributes: ['id', 'name', 'logoUrl'],
      order: [['name', 'ASC']],
      limit,
    });
    return groups.map((g) => ({ id: g.id, name: g.name, logoUrl: g.logoUrl }));
  }

  /**
   * Get all groups owned by the instructor
   */
  async getInstructorsGroups(instructorId: string): Promise<Group[]> {
    const memberCountLiteral = literal(
      '(SELECT COUNT(*)::int FROM group_member WHERE group_member.group_id = "Group"."id" AND group_member.left_at IS NULL)',
    );

    return this.groupModel.findAll({
      where: { instructorId },
      attributes: {
        include: [[memberCountLiteral, 'memberCount']],
      },
    });
  }

  /**
   * Get group by ID (only if user is a member)
   *
   * Uses a targeted membership check instead of loading all members.
   */
  /**
   * One group, as the caller sees it.
   *
   * `myRole` rides along because the membership row is already loaded to
   * authorise the read — the client would otherwise have to derive it by
   * searching the paginated member list, which silently misreads a
   * moderator who sits past the first page as a non-member and strips
   * their controls. The role is authoritative here and costs nothing.
   */
  async getById(
    groupId: string,
    userId: string,
  ): Promise<Group & { myRole: GroupMemberRole; memberCount: number }> {
    const group = await this.groupModel.findByPk(groupId, {
      // Every list endpoint attaches this; the single-group read did not, so
      // a detail screen rendered "0 members" for a group the list it came
      // from had just counted correctly.
      attributes: {
        include: [
          [
            literal(
              '(SELECT COUNT(*)::int FROM group_member WHERE group_member.group_id = "Group"."id" AND group_member.left_at IS NULL)',
            ),
            'memberCount',
          ],
        ],
      },
    });

    if (!group) {
      throw new NotFoundException(apiError('group.notFound'));
    }

    const member = await this.assertMember(groupId, userId);

    // `toJSON` first: spreading a Sequelize instance copies its internals,
    // not its columns.
    return { ...group.toJSON(), myRole: member.role } as Group & {
      myRole: GroupMemberRole;
      memberCount: number;
    };
  }

  /**
   * Update group (owner only)
   *
   * If name is changed, slug is automatically regenerated.
   */
  async update(
    groupId: string,
    userId: string,
    dto: UpdateGroupDto,
  ): Promise<Group> {
    const group = await this.assertOwnerAndGet(groupId, userId);

    // If name changes, regenerate slug. `slug` isn't on UpdateGroupDto
    // (the client can't set it directly); we attach it here so Sequelize
    // writes it alongside the DTO payload. Slug lookup + write share a
    // transaction so a concurrent rename can't grab the same slug between
    // the uniqueness check and the update — the unique index is the real
    // guard, but this collapses the race window.
    const updatePayload: UpdateGroupDto & { slug?: string } = { ...dto };
    const sequelize = this.groupModel.sequelize!;
    const tx = await sequelize.transaction();
    try {
      if (dto.name && dto.name !== group.name) {
        const baseSlug = this.generateSlug(dto.name);
        updatePayload.slug = await this.ensureUniqueSlug(baseSlug, tx);
      }
      await group.update(updatePayload, { transaction: tx });
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    await this.searchIndexService.upsertGroup(group.id);
    return group;
  }

  /**
   * Delete group (owner only, soft delete)
   */
  async deleteGroup(groupId: string, userId: string): Promise<void> {
    const group = await this.assertOwnerAndGet(groupId, userId);

    // Invalidate any outstanding join link before soft-deleting the group
    // so a stale token can't be redeemed if the group is ever restored or
    // if a paranoid filter is bypassed. Both writes share a transaction.
    const sequelize = this.groupModel.sequelize!;
    const tx = await sequelize.transaction();
    try {
      await group.update(
        { joinToken: null, joinTokenExpiresAt: null },
        { transaction: tx },
      );
      await group.destroy({ transaction: tx });
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    await this.searchIndexService.removeIfExists('group', group.id);

    this.logger.log(
      `Group deleted: ${group.name} (${group.id}) by user ${userId}`,
      'GroupService',
    );
  }

  /**
   * Leave a group voluntarily
   *
   * Owners cannot leave -- they must transfer ownership first or delete the group.
   */
  async leaveGroup(groupId: string, userId: string): Promise<void> {
    const member = await this.memberModel.findOne({
      where: { groupId, userId, leftAt: null },
    });

    if (!member) {
      throw new NotFoundException(apiError('group.notMember'));
    }

    if (member.isOwner) {
      throw new ForbiddenException(apiError('group.ownerCannotLeave'));
    }

    await member.update({ leftAt: new Date() });

    this.logger.log(`User ${userId} left group ${groupId}`, 'GroupService');

    // Notify the owner (in-app + email). Best-effort — failures here log
    // but don't bubble; the leave action already succeeded.
    const group = await this.groupModel.findByPk(groupId, {
      attributes: ['id', 'name', 'instructorId'],
    });
    if (!group) return;
    const [leaver, owner] = await Promise.all([
      this.userModel.findByPk(userId, {
        attributes: ['firstName', 'lastName'],
      }),
      this.userModel.findByPk(group.instructorId, {
        attributes: ['email', 'firstName', 'language'],
      }),
    ]);
    const memberName =
      [leaver?.firstName, leaver?.lastName].filter(Boolean).join(' ').trim() ||
      null;

    await this.notificationService
      .notify(
        groupMemberLeft(
          group.instructorId,
          { id: group.id, name: group.name },
          memberName,
        ),
      )
      .catch((err: Error) =>
        this.logger.error(
          `[groups] notify GROUP_MEMBER_LEFT failed for owner ${group.instructorId}, group ${groupId}: ${err.message}`,
          'GroupService',
        ),
      );

    if (owner?.email) {
      this.emailService
        .sendGroupMemberLeftEmail({
          to: owner.email,
          ownerFirstName: owner.firstName,
          memberName,
          groupName: group.name,
          groupId: group.id,
          locale: toLocale(owner.language),
        })
        .catch((err: Error) =>
          this.logger.error(
            `[groups] sendGroupMemberLeftEmail failed for owner ${group.instructorId}, group ${groupId}: ${err.message}`,
            'GroupService',
          ),
        );
    }

    await this.refreshSearch(groupId);
  }

  // =====================================================
  // MEMBER MANAGEMENT
  // =====================================================

  /**
   * Get all members of a group (paginated)
   *
   * Returns basic info for all members.
   * Also checks the instructor_client table to determine which members
   * are clients of the group's instructor, adding an `isClient` flag.
   */
  async getMembers(
    groupId: string,
    userId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const requester = await this.assertMember(groupId, userId);
    const requesterIsOwner = requester.role === GroupMemberRole.OWNER;

    const offset = (page - 1) * limit;

    // First, get the group to know the instructor
    const group = await this.groupModel.findByPk(groupId);
    if (!group) {
      throw new NotFoundException(apiError('group.notFound'));
    }

    const { rows: members, count: totalItems } =
      await this.memberModel.findAndCountAll({
        where: { groupId, leftAt: null },
        include: [
          {
            model: User,
            attributes: [...USER_SAFE_ATTRIBUTES, 'privacySettings'],
          },
        ],
        limit,
        offset,
        order: [['joinedAt', 'ASC']],
      });

    // Query the instructor_client table to check which members are clients
    // of this group's instructor (ACTIVE status only)
    const memberUserIds = members.map((m) => m.userId);
    let clientIdSet = new Set<string>();

    if (memberUserIds.length > 0) {
      const clientRelationships = await this.instructorClientModel.findAll({
        where: {
          instructorId: group.instructorId,
          clientId: { [Op.in]: memberUserIds },
          status: 'ACTIVE',
        },
        attributes: ['clientId'],
      });
      clientIdSet = new Set(clientRelationships.map((r) => r.clientId));
    }

    const data = members.map((member) => ({
      id: member.id,
      userId: member.userId,
      user: {
        id: member.user.id,
        firstName: member.user.firstName,
        lastName: member.user.lastName,
        handle: member.user.handle ?? null,
        // Only the owner sees anyone else's email, and only as far as that
        // person's own privacy setting allows; everyone sees their own.
        email: this.contactFor(
          member.user,
          'email',
          member.userId === userId
            ? 'OWNER'
            : requesterIsOwner
              ? clientIdSet.has(member.userId)
                ? 'COACH'
                : 'PUBLIC'
              : null,
        ),
        avatarId: member.user.avatarId,
        avatarUrl: member.user.avatarUrl,
      },
      role: member.role,
      // Kept for backwards compat with FE that hasn't migrated to `role`.
      isOwner: member.isOwner,
      nickname: member.nickname,
      sharedHealthInfo: member.sharedHealthInfo,
      joinedAt: member.joinedAt,
      isClient: clientIdSet.has(member.userId),
    }));

    return buildPaginatedResponse(data, totalItems, page, limit);
  }

  /**
   * Update own membership settings (sharedHealthInfo, nickname)
   */
  async updateMyMembership(
    groupId: string,
    userId: string,
    dto: UpdateMemberDto,
  ): Promise<GroupMember> {
    const member = await this.memberModel.findOne({
      where: { groupId, userId, leftAt: null },
    });

    if (!member) {
      throw new NotFoundException(apiError('group.notMember'));
    }

    await member.update(dto);
    return member;
  }

  /**
   * Remove a member from the group (owner only)
   *
   * The owner cannot be removed.
   */
  async removeMember(
    groupId: string,
    memberId: string,
    userId: string,
  ): Promise<void> {
    const group = await this.assertOwnerAndGet(groupId, userId);

    const member = await this.memberModel.findOne({
      where: { groupId, userId: memberId, leftAt: null },
    });

    if (!member) {
      throw new NotFoundException(apiError('group.memberNotFound'));
    }

    if (member.isOwner) {
      throw new ForbiddenException(apiError('group.cannotRemoveOwner'));
    }

    await member.update({ leftAt: new Date() });

    this.logger.log(
      `Member ${memberId} removed from group ${groupId} by ${userId}`,
      'GroupService',
    );

    await this.notificationService
      .notify(groupMemberRemoved(memberId, { id: group.id, name: group.name }))
      .catch((err: Error) =>
        this.logger.error(
          `[groups] notify GROUP_MEMBER_REMOVED failed for user ${memberId}, group ${groupId}: ${err.message}`,
          'GroupService',
        ),
      );

    // Email the removed member so they know they lost access. Best-
    // effort; transport failures must not turn the 200 into a 500.
    const removedUser = await this.userModel.findByPk(memberId, {
      attributes: ['email', 'firstName', 'language'],
    });
    if (removedUser?.email) {
      this.emailService
        .sendGroupMemberRemovedEmail({
          to: removedUser.email,
          memberFirstName: removedUser.firstName,
          groupName: group.name,
          locale: toLocale(removedUser.language),
        })
        .catch((err: Error) =>
          this.logger.error(
            `[groups] sendGroupMemberRemovedEmail failed for user ${memberId}, group ${groupId}: ${err.message}`,
            'GroupService',
          ),
        );
    }

    await this.refreshSearch(groupId);
  }

  // =====================================================
  // DISCOVERY (PUBLIC -- no membership required)
  // =====================================================

  /**
   * Discover public groups
   *
   * Returns paginated list of public, active groups.
   * Supports filtering by tags (JSON_CONTAINS for MySQL), city, country,
   * and free-text search on name/description.
   * Sorted by member count (most popular first).
   *
   * Authentication is optional. When `currentUserId` is provided:
   * - Groups the user is already an active member of are excluded.
   * - Each row is enriched with `myJoinRequestStatus: 'PENDING' | null`
   *   so the UI can render "Request pending" instead of "Request to join".
   *
   * Anonymous callers see the unfiltered public list with no
   * `myJoinRequestStatus` field.
   */
  async discoverGroups(
    dto: DiscoverGroupsDto,
    currentUserId: string | null = null,
  ) {
    const page = dto.page || 1;
    const limit = dto.limit || 20;
    const offset = (page - 1) * limit;

    const sequelize = this.groupModel.sequelize!;
    const tagConditions =
      dto.tags && dto.tags.length > 0
        ? dto.tags.map((tag) =>
            literal(
              `tags::jsonb @> ${sequelize.escape(JSON.stringify([tag]))}::jsonb`,
            ),
          )
        : null;
    const term = dto.search ? buildSearchTerm(dto.search) : null;

    // When the caller is signed in, exclude any group where they're an
    // active member. Member groups belong in "Your groups", not Discover.
    const excludeMemberClause = currentUserId
      ? [
          literal(
            `NOT EXISTS (SELECT 1 FROM group_member gm WHERE gm.group_id = "Group"."id" AND gm.user_id = ${sequelize.escape(currentUserId)} AND gm.left_at IS NULL)`,
          ),
        ]
      : [];

    const andClauses = [...(tagConditions ?? []), ...excludeMemberClause];

    const where: WhereOptions<Group> = {
      isPublic: true,
      isActive: true,
      joinPolicy: { [Op.ne]: JoinPolicy.INVITE_ONLY },
      ...(dto.city && { city: { [Op.iLike]: `%${dto.city}%` } }),
      ...(dto.country && { country: dto.country }),
      ...(andClauses.length > 0 && { [Op.and]: andClauses }),
      // Accent- and case-blind, as exercise and program search are: someone
      // typing "forta" is looking for "Forță", and most phones type without
      // diacritics. `fold_for_search` is the shared unaccent + lower (063).
      ...(term && {
        [Op.or]: [
          literal(
            `fold_for_search("Group"."name") LIKE fold_for_search(${sequelize.escape(term)})`,
          ),
          literal(
            `fold_for_search(COALESCE("Group"."description", '')) LIKE fold_for_search(${sequelize.escape(term)})`,
          ),
        ],
      }),
    };

    const memberCountLiteral = literal(
      '(SELECT COUNT(*)::int FROM group_member WHERE group_member.group_id = "Group"."id" AND group_member.left_at IS NULL)',
    );

    const { rows: data, count: totalItems } =
      await this.groupModel.findAndCountAll({
        where,
        attributes: {
          include: [
            'id',
            'name',
            'slug',
            'description',
            'logoUrl',
            'joinPolicy',
            'tags',
            'city',
            'country',
            'createdAt',
            [memberCountLiteral, 'memberCount'],
          ],
        },
        order: [[memberCountLiteral, 'DESC']],
        limit,
        offset,
      });

    if (!currentUserId) {
      return buildPaginatedResponse(data, totalItems, page, limit);
    }

    // Enrich each row with the caller's PENDING request status so the
    // FE can render "Request pending" without a second round-trip.
    const groupIds = data.map((g) => g.id);
    const pendingRequests =
      groupIds.length > 0
        ? await this.joinRequestModel.findAll({
            where: {
              userId: currentUserId,
              groupId: { [Op.in]: groupIds },
              status: GroupJoinRequestStatus.PENDING,
            },
            attributes: ['groupId'],
          })
        : [];
    const pendingSet = new Set(pendingRequests.map((r) => r.groupId));

    const enriched = data.map((g) => {
      const json: Record<string, unknown> = g.toJSON();
      json.myJoinRequestStatus = pendingSet.has(g.id) ? 'PENDING' : null;
      return json;
    });

    return buildPaginatedResponse(enriched, totalItems, page, limit);
  }

  /**
   * Public groups owned by a single instructor.
   *
   * Feeds the Groups tab on the Public Profile page (`/@<handle>`). We
   * only surface groups the instructor has marked public and active, and
   * we exclude INVITE_ONLY groups — a visitor who can't self-join has
   * nothing to do with the card. Sorted by member count so the most
   * active group appears first.
   */
  async listPublicGroupsForInstructor(instructorUserId: string) {
    const memberCountLiteral = literal(
      '(SELECT COUNT(*)::int FROM group_member WHERE group_member.group_id = "Group"."id" AND group_member.left_at IS NULL)',
    );

    const groups = await this.groupModel.findAll({
      where: {
        instructorId: instructorUserId,
        isPublic: true,
        isActive: true,
        joinPolicy: { [Op.ne]: JoinPolicy.INVITE_ONLY },
      },
      attributes: {
        include: [
          'id',
          'name',
          'slug',
          'description',
          'logoUrl',
          'joinPolicy',
          'tags',
          'city',
          'country',
          'createdAt',
          [memberCountLiteral, 'memberCount'],
        ],
      },
      order: [[memberCountLiteral, 'DESC']],
      limit: 20,
    });

    return groups.map((g) => g.toJSON());
  }

  /**
   * Get public profile of a group
   *
   * Returns group details, instructor info, and upcoming public sessions.
   * Visible to anyone -- no membership required.
   */
  async getPublicProfile(groupId: string) {
    const memberCountLiteral = literal(
      '(SELECT COUNT(*)::int FROM group_member WHERE group_member.group_id = "Group"."id" AND group_member.left_at IS NULL)',
    );

    const group = await this.groupModel.findOne({
      where: {
        id: groupId,
        isPublic: true,
        isActive: true,
      },
      attributes: {
        include: [
          'id',
          'name',
          'slug',
          'description',
          'logoUrl',
          'joinPolicy',
          'tags',
          'contactEmail',
          'contactPhone',
          'address',
          'city',
          'country',
          'timezone',
          'createdAt',
          [memberCountLiteral, 'memberCount'],
        ],
      },
    });

    if (!group) {
      throw new NotFoundException(apiError('group.notPublic'));
    }

    // Get the instructor (owner)
    const ownerMembership = await this.memberModel.findOne({
      where: { groupId, role: GroupMemberRole.OWNER, leftAt: null },
      include: [
        {
          model: User,
          attributes: USER_SAFE_ATTRIBUTES,
        },
      ],
    });

    // Get instructor's profile (if public)
    let instructorProfile: PublicInstructorProfile | null = null;
    if (ownerMembership) {
      const orgProfile = await InstructorProfile.findOne({
        where: { userId: ownerMembership.userId, isPublic: true },
        attributes: [
          'displayName',
          'bio',
          'specializations',
          'yearsOfExperience',
          'isAcceptingClients',
          'socialLinks',
          'showSocialLinks',
          'showEmail',
          'showPhone',
        ],
      });

      if (orgProfile) {
        instructorProfile = {
          userId: ownerMembership.userId,
          firstName: ownerMembership.user.firstName,
          lastName: ownerMembership.user.lastName,
          avatarId: ownerMembership.user.avatarId,
          displayName: orgProfile.displayName,
          bio: orgProfile.bio,
          specializations: orgProfile.specializations,
          yearsOfExperience: orgProfile.yearsOfExperience,
          isAcceptingClients: orgProfile.isAcceptingClients,
          socialLinks: orgProfile.showSocialLinks
            ? orgProfile.socialLinks
            : null,
        };
      } else {
        instructorProfile = {
          userId: ownerMembership.userId,
          firstName: ownerMembership.user.firstName,
          lastName: ownerMembership.user.lastName,
          avatarId: ownerMembership.user.avatarId,
        };
      }
    }

    // Get upcoming public/group sessions linked to this group's instructor
    const instructorId =
      group.getDataValue('instructorId') || ownerMembership?.userId;
    const upcomingSessions = instructorId
      ? await SessionInstance.findAll({
          where: {
            instructorId,
            status: {
              [Op.in]: [
                SessionInstanceStatus.Scheduled,
                SessionInstanceStatus.InProgress,
              ],
            },
            startAt: { [Op.gte]: new Date() },
          },
          include: [
            {
              model: SessionTemplate,
              as: 'template',
              where: {
                access: {
                  [Op.in]: [SessionAccess.Open, SessionAccess.GroupOnly],
                },
              },
              attributes: [
                'title',
                'description',
                'type',
                'access',
                'locationKind',
                'durationMinutes',
                'capacity',
                'priceAmountCents',
                'priceCurrency',
              ],
              required: true,
            },
          ],
          order: [['startAt', 'ASC']],
          limit: 10,
        })
      : [];

    return {
      group,
      instructor: instructorProfile,
      upcomingSessions,
    };
  }

  // =====================================================
  // SELF-JOIN
  // =====================================================

  /**
   * Self-join a public group.
   *
   * Branches on the group's joinPolicy:
   * - OPEN     → instant membership (returns { status: 'JOINED', member }).
   * - APPROVAL → creates (or returns existing) PENDING GroupJoinRequest
   *              and notifies the owner. Returns { status: 'PENDING', request }.
   *              Idempotent: a second call while still pending returns the
   *              same request rather than creating a duplicate.
   * - INVITE_ONLY → ForbiddenException; user needs an invite/link.
   *
   * Throws if the group is not public or already-joined.
   */
  async selfJoinGroup(
    groupId: string,
    userId: string,
  ): Promise<SelfJoinResult> {
    const group = await this.groupModel.findByPk(groupId);

    if (!group || !group.isActive) {
      throw new NotFoundException(apiError('group.notFound'));
    }

    if (!group.isPublic) {
      throw new ForbiddenException(apiError('group.invitationRequired'));
    }

    if (group.joinPolicy === JoinPolicy.INVITE_ONLY) {
      throw new ForbiddenException(apiError('group.inviteOnly'));
    }

    // Look up *any* existing membership row, including ones the user
    // previously left. The UNIQUE index on (group_id, user_id) covers
    // all rows regardless of leftAt, so we must revive the existing
    // row rather than insert a new one.
    const existingMember = await this.memberModel.findOne({
      where: { groupId, userId },
    });
    if (existingMember && existingMember.leftAt === null) {
      throw new BadRequestException(apiError('group.alreadyMember'));
    }

    if (group.joinPolicy === JoinPolicy.OPEN) {
      let member: GroupMember;
      if (existingMember) {
        // Re-joining: clear leftAt + reset role.
        await existingMember.update({
          leftAt: null,
          role: GroupMemberRole.MEMBER,
        });
        member = existingMember;
      } else {
        member = await this.memberModel.create({
          groupId,
          userId,
          role: GroupMemberRole.MEMBER,
        });
      }
      this.logger.log(
        `User ${userId} self-joined group ${group.name} (${groupId})`,
        'GroupService',
      );
      await this.refreshSearch(groupId);
      return { status: 'JOINED', member };
    }

    // joinPolicy === APPROVAL: create or reuse PENDING request.
    const existingPending = await this.joinRequestModel.findOne({
      where: { groupId, userId, status: GroupJoinRequestStatus.PENDING },
    });
    if (existingPending) {
      return { status: 'PENDING', request: existingPending };
    }

    const request = await this.joinRequestModel.create({
      groupId,
      userId,
      status: GroupJoinRequestStatus.PENDING,
    });

    this.logger.log(
      `User ${userId} requested to join group ${group.name} (${groupId})`,
      'GroupService',
    );

    // Notify the owner. Best-effort — don't fail the request creation if
    // the notification pipeline has a hiccup.
    const requester = await this.userModel.findByPk(userId, {
      attributes: ['id', 'firstName', 'lastName'],
    });
    const requesterName =
      [requester?.firstName, requester?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || null;
    await this.notificationService
      .notify(
        groupJoinRequestReceived(
          group.instructorId,
          { id: group.id, name: group.name },
          requesterName,
        ),
      )
      .catch((err) => {
        this.logger.error(
          `[groups] notify GROUP_JOIN_REQUEST_RECEIVED failed for owner ${group.instructorId}, group ${groupId}: ${(err as Error).message}`,
          'GroupService',
        );
      });

    // Email the owner so they actually see the request (in-app bells
    // are easy to miss). Best-effort.
    const owner = await this.userModel.findByPk(group.instructorId, {
      attributes: ['email', 'firstName', 'language'],
    });
    if (owner?.email) {
      this.emailService
        .sendGroupJoinRequestReceivedEmail({
          to: owner.email,
          ownerFirstName: owner.firstName,
          requesterName,
          groupName: group.name,
          groupId: group.id,
          requestId: request.id,
          locale: toLocale(owner.language),
        })
        .catch((err: Error) =>
          this.logger.error(
            `[groups] sendGroupJoinRequestReceivedEmail failed for owner ${group.instructorId}, group ${groupId}: ${err.message}`,
            'GroupService',
          ),
        );
    }

    return { status: 'PENDING', request };
  }

  // =====================================================
  // JOIN REQUEST WORKFLOW (APPROVAL groups)
  // =====================================================

  /**
   * List pending join requests for a group (owner only).
   *
   * Returns paginated PENDING requests with the requesting user hydrated.
   */
  async listJoinRequests(
    groupId: string,
    requestingUserId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    await this.assertOwnerAndGet(groupId, requestingUserId);
    const offset = (page - 1) * limit;

    const group = await this.groupModel.findByPk(groupId, {
      attributes: ['instructorId'],
    });
    const { rows, count } = await this.joinRequestModel.findAndCountAll({
      where: { groupId, status: GroupJoinRequestStatus.PENDING },
      include: [
        {
          model: User,
          as: 'user',
          attributes: [...USER_SAFE_ATTRIBUTES, 'privacySettings'],
        },
      ],
      order: [['createdAt', 'DESC']],
      offset,
      limit,
    });

    // The owner sees a requester's email and phone only as far as that
    // person's privacy settings allow: their coach sees "coaches only".
    const clients = group
      ? await this.instructorClientModel.findAll({
          where: {
            instructorId: group.instructorId,
            clientId: { [Op.in]: rows.map((r) => r.userId) },
            status: 'ACTIVE',
          },
          attributes: ['clientId'],
        })
      : [];
    const clientIds = new Set(clients.map((c) => c.clientId));

    const data = rows.map((row) => {
      const { user, ...request } = row.get({
        plain: true,
      }) as GroupJoinRequest & {
        user?: User;
      };
      if (!user) return request;
      const audience: PublicProfileAudience = clientIds.has(row.userId)
        ? 'COACH'
        : 'PUBLIC';
      const { privacySettings: _settings, ...safe } = user;
      void _settings;
      return {
        ...request,
        user: {
          ...safe,
          email: this.contactFor(user, 'email', audience),
          phone: this.contactFor(user, 'phone', audience),
        },
      };
    });

    return buildPaginatedResponse(data, count, page, limit);
  }

  /**
   * Approve or reject a pending join request (owner only).
   *
   * Approve: atomically marks the request APPROVED and creates a
   *          GroupMember row. Idempotent if the user is already an
   *          active member (just marks the request).
   * Reject : marks the request REJECTED, no membership created.
   *
   * Either way, the requesting user gets a notification.
   */
  async decideJoinRequest(
    groupId: string,
    requestId: string,
    requestingUserId: string,
    dto: DecideJoinRequestDto,
  ): Promise<GroupJoinRequest> {
    const group = await this.assertOwnerAndGet(groupId, requestingUserId);

    const request = await this.joinRequestModel.findOne({
      where: { id: requestId, groupId },
    });
    if (!request) {
      throw new NotFoundException(apiError('group.joinRequestNotFound'));
    }
    if (request.status !== GroupJoinRequestStatus.PENDING) {
      throw new BadRequestException(
        apiError('group.joinRequestAlreadyDecided', { status: request.status }),
      );
    }

    const sequelize = this.joinRequestModel.sequelize!;
    const tx = await sequelize.transaction();
    try {
      if (dto.action === JoinRequestDecision.APPROVE) {
        const existing = await this.memberModel.findOne({
          where: { groupId, userId: request.userId },
          transaction: tx,
        });
        if (existing) {
          if (existing.leftAt !== null) {
            await existing.update({ leftAt: null }, { transaction: tx });
          }
        } else {
          await this.memberModel.create(
            {
              groupId,
              userId: request.userId,
              role: GroupMemberRole.MEMBER,
            },
            { transaction: tx },
          );
        }
        await request.update(
          {
            status: GroupJoinRequestStatus.APPROVED,
            decidedById: requestingUserId,
            decidedAt: new Date(),
          },
          { transaction: tx },
        );
      } else {
        await request.update(
          {
            status: GroupJoinRequestStatus.REJECTED,
            decidedById: requestingUserId,
            decidedAt: new Date(),
          },
          { transaction: tx },
        );
      }
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }

    this.logger.log(
      `Join request ${requestId} ${dto.action === JoinRequestDecision.APPROVE ? 'approved' : 'rejected'} for group ${groupId} by ${requestingUserId}`,
      'GroupService',
    );

    const approved = dto.action === JoinRequestDecision.APPROVE;
    const params = approved
      ? groupJoinRequestApproved(request.userId, {
          id: group.id,
          name: group.name,
        })
      : groupJoinRequestRejected(request.userId, {
          id: group.id,
          name: group.name,
        });
    // notify-after-commit: fired AFTER the tx above resolves, so a
    // rollback can never leave an orphan "you were approved" alert.
    // Do NOT hoist this inside the transaction block.
    await this.notificationService.notify(params).catch((err) => {
      this.logger.error(
        `[groups] notify join-request decision failed for user ${request.userId}, group ${groupId}: ${(err as Error).message}`,
        'GroupService',
      );
    });

    // Email the requester so they don't have to keep checking the
    // bell. Best-effort.
    const requester = await this.userModel.findByPk(request.userId, {
      attributes: ['email', 'firstName', 'language'],
    });
    if (requester?.email) {
      this.emailService
        .sendGroupJoinRequestDecidedEmail({
          to: requester.email,
          decision: approved ? 'approved' : 'rejected',
          requesterFirstName: requester.firstName,
          groupName: group.name,
          groupId: group.id,
          locale: toLocale(requester.language),
        })
        .catch((err: Error) =>
          this.logger.error(
            `[groups] sendGroupJoinRequestDecidedEmail failed for user ${request.userId}, group ${groupId}: ${err.message}`,
            'GroupService',
          ),
        );
    }

    await this.refreshSearch(groupId);
    return request;
  }

  /**
   * Get the current user's PENDING request for a group, or null.
   *
   * Lightweight check used by the FE to render "Request pending" instead
   * of "Request to join" when the user revisits Discover.
   */
  async getMyJoinRequest(
    groupId: string,
    userId: string,
  ): Promise<GroupJoinRequest | null> {
    return this.joinRequestModel.findOne({
      where: {
        groupId,
        userId,
        status: GroupJoinRequestStatus.PENDING,
      },
    });
  }

  /**
   * Cancel the current user's own PENDING request.
   *
   * No-op if no pending request exists (returns silently — idempotent).
   */
  async cancelMyJoinRequest(groupId: string, userId: string): Promise<void> {
    const request = await this.joinRequestModel.findOne({
      where: {
        groupId,
        userId,
        status: GroupJoinRequestStatus.PENDING,
      },
    });
    if (!request) return;

    await request.update({
      status: GroupJoinRequestStatus.CANCELLED,
      decidedAt: new Date(),
    });

    this.logger.log(
      `Join request ${request.id} cancelled by user ${userId} (group ${groupId})`,
      'GroupService',
    );
  }

  /**
   * Return the list of group ids the user is an active member of.
   *
   * Used by PostService to build the cross-group feed without depending
   * on the GroupMember model directly.
   */
  async findMyGroupIds(userId: string): Promise<string[]> {
    const memberships = await this.memberModel.findAll({
      where: { userId, leftAt: null },
      attributes: ['groupId'],
    });
    return memberships.map((m) => m.groupId);
  }

  // =====================================================
  // JOIN LINK MANAGEMENT
  // =====================================================

  /**
   * Generate a join link for the group
   *
   * Creates a cryptographically random token with an expiry (default 7 days).
   * The token is hashed before storage so a DB breach cannot leak valid links.
   *
   * Returns the plain token to be shared (e.g. in a URL).
   */
  async generateJoinLink(
    groupId: string,
    userId: string,
    expiryDays: number = 7,
  ): Promise<{ token: string; expiresAt: Date }> {
    await this.assertOwnerAndGet(groupId, userId);

    const token = this.cryptoService.generateToken(32);
    const hashedToken = this.cryptoService.hashToken(token);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiryDays);

    await this.groupModel.update(
      { joinToken: hashedToken, joinTokenExpiresAt: expiresAt },
      { where: { id: groupId } },
    );

    this.logger.log(
      `Join link generated for group ${groupId} by instructor ${userId}, expires ${expiresAt.toISOString()}`,
      'GroupService',
    );

    return { token, expiresAt };
  }

  /**
   * Revoke an existing join link
   *
   * Clears the joinToken and joinTokenExpiresAt fields so the link
   * can no longer be used.
   */
  async revokeJoinLink(groupId: string, userId: string): Promise<void> {
    await this.assertOwnerAndGet(groupId, userId);

    await this.groupModel.update(
      { joinToken: null, joinTokenExpiresAt: null },
      { where: { id: groupId } },
    );

    this.logger.log(
      `Join link revoked for group ${groupId} by instructor ${userId}`,
      'GroupService',
    );
  }

  /**
   * Join a group via an invite link token
   *
   * Validates the token against the hashed value in the DB,
   * checks expiry, and adds the user as a member.
   */
  async joinViaLink(token: string, userId: string): Promise<GroupMember> {
    const hashedToken = this.cryptoService.hashToken(token);

    const group = await this.groupModel.findOne({
      where: { joinToken: hashedToken },
    });

    if (!group || !group.isActive) {
      throw new NotFoundException(apiError('group.joinLinkInvalid'));
    }

    // Check expiry
    if (
      group.joinTokenExpiresAt &&
      new Date() > new Date(group.joinTokenExpiresAt)
    ) {
      throw new BadRequestException(apiError('group.joinLinkExpired'));
    }

    // Look up *any* existing membership row, including ones the user
    // previously left. The UNIQUE index on (group_id, user_id) covers
    // all rows regardless of leftAt, so we must revive the existing
    // row rather than insert a new one.
    const existing = await this.memberModel.findOne({
      where: { groupId: group.id, userId },
    });

    if (existing && existing.leftAt === null) {
      throw new BadRequestException(apiError('group.alreadyMember'));
    }

    let member: GroupMember;
    if (existing) {
      await existing.update({ leftAt: null, role: GroupMemberRole.MEMBER });
      member = existing;
    } else {
      member = await this.memberModel.create({
        groupId: group.id,
        userId,
        role: GroupMemberRole.MEMBER,
      });
    }

    this.logger.log(
      `User ${userId} joined group ${group.name} (${group.id}) via join link`,
      'GroupService',
    );

    await this.refreshSearch(group.id);
    return member;
  }

  // =====================================================
  // HELPERS (used by other services, e.g. InvitationService)
  // =====================================================

  /**
   * Add multiple users as members in a single transaction (owner only).
   *
   * - Active members (leftAt IS NULL) are silently skipped.
   * - Previously-removed members (leftAt IS NOT NULL) are re-activated.
   * - Unknown users are created fresh.
   * Returns newly created or re-activated memberships.
   */
  async addMembersBulk(
    groupId: string,
    requestingUserId: string,
    userIds: string[],
  ): Promise<GroupMember[]> {
    await this.assertOwnerAndGet(groupId, requestingUserId);

    const sequelize = this.groupModel.sequelize!;
    const transaction = await sequelize.transaction();

    try {
      const allExisting = await this.memberModel.findAll({
        where: { groupId, userId: { [Op.in]: userIds } },
        attributes: ['userId', 'leftAt'],
        transaction,
      });

      const activeIds = new Set(
        allExisting.filter((m) => m.leftAt === null).map((m) => m.userId),
      );
      const rejoinIds = new Set(
        allExisting.filter((m) => m.leftAt !== null).map((m) => m.userId),
      );

      const toCreate = userIds.filter(
        (id) => !activeIds.has(id) && !rejoinIds.has(id),
      );

      const [reactivated, created] = await Promise.all([
        rejoinIds.size > 0
          ? this.memberModel
              .update(
                { leftAt: null },
                {
                  where: {
                    groupId,
                    userId: { [Op.in]: [...rejoinIds] },
                  },
                  transaction,
                },
              )
              .then(() =>
                this.memberModel.findAll({
                  where: { groupId, userId: { [Op.in]: [...rejoinIds] } },
                  transaction,
                }),
              )
          : Promise.resolve([] as GroupMember[]),
        Promise.all(
          toCreate.map((userId) =>
            this.memberModel.create(
              { groupId, userId, role: GroupMemberRole.MEMBER },
              { transaction },
            ),
          ),
        ),
      ]);

      await transaction.commit();

      this.logger.log(
        `Group ${groupId}: ${created.length} added, ${reactivated.length} re-activated, ${activeIds.size} skipped (already active) — by ${requestingUserId}`,
        'GroupService',
      );

      await this.refreshSearch(groupId);
      return [...reactivated, ...created];
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  /**
   * Add a user as a member (used by InvitationService).
   *
   * - Active member: returns existing record unchanged.
   * - Previously-removed member (leftAt set): clears leftAt and returns record.
   * - Unknown: creates a new membership with role=MEMBER.
   */
  async addMember(
    groupId: string,
    userId: string,
    externalTransaction?: Transaction,
  ): Promise<GroupMember> {
    const txOpt = externalTransaction
      ? { transaction: externalTransaction }
      : {};

    const existing = await this.memberModel.findOne({
      where: { groupId, userId },
      ...txOpt,
    });

    if (existing) {
      if (existing.leftAt !== null) {
        await existing.update({ leftAt: null }, txOpt);
      }
      return existing;
    }

    return this.memberModel.create(
      { groupId, userId, role: GroupMemberRole.MEMBER },
      txOpt,
    );
  }

  // =====================================================
  // OWNERSHIP TRANSFER & STATS
  // =====================================================

  /**
   * Transfer group ownership to another member.
   */
  async transferOwnership(
    groupId: string,
    currentOwnerId: string,
    newOwnerId: string,
  ): Promise<{ message: string }> {
    const group = await this.assertOwnerAndGet(groupId, currentOwnerId);

    if (currentOwnerId === newOwnerId) {
      throw new BadRequestException(apiError('group.alreadyOwner'));
    }

    const newOwnerMember = await this.memberModel.findOne({
      where: { groupId, userId: newOwnerId, leftAt: null },
    });

    if (!newOwnerMember) {
      throw new BadRequestException(apiError('group.newOwnerNotMember'));
    }

    const sequelize = this.groupModel.sequelize!;
    const transaction = await sequelize.transaction();

    try {
      // Demote current owner to MEMBER. (Promoting them to MODERATOR
      // instead would be a separate product decision; keeping the
      // current behaviour — old owner becomes a regular member.)
      // Scoped to the active membership row so any historical (left)
      // rows for the same user aren't touched.
      await this.memberModel.update(
        { role: GroupMemberRole.MEMBER },
        {
          where: { groupId, userId: currentOwnerId, leftAt: null },
          transaction,
        },
      );

      // Promote new owner. Same scoping rule.
      await this.memberModel.update(
        { role: GroupMemberRole.OWNER },
        {
          where: { groupId, userId: newOwnerId, leftAt: null },
          transaction,
        },
      );

      // Update group instructorId
      await this.groupModel.update(
        { instructorId: newOwnerId },
        { where: { id: groupId }, transaction },
      );

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    this.logger.log(
      `Group ${groupId} ownership transferred from ${currentOwnerId} to ${newOwnerId}`,
      'GroupService',
    );

    // Notify both parties after commit. Failures here log but don't
    // bubble — the transfer already succeeded; a flaky bell shouldn't
    // turn a 200 into a 500. Each notify is independently caught so
    // one failing recipient doesn't block the other.
    const groupRef = { id: group.id, name: group.name };
    const [newOwnerUser, oldOwnerUser] = await Promise.all([
      this.userModel.findByPk(newOwnerId, {
        attributes: ['email', 'firstName', 'lastName', 'language'],
      }),
      this.userModel.findByPk(currentOwnerId, {
        attributes: ['email', 'firstName', 'lastName', 'language'],
      }),
    ]);
    const newOwnerName =
      [newOwnerUser?.firstName, newOwnerUser?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || null;
    const oldOwnerName =
      [oldOwnerUser?.firstName, oldOwnerUser?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || null;

    await Promise.all([
      this.notificationService
        .notify(groupOwnershipTransferredToNewOwner(newOwnerId, groupRef))
        .catch((err: Error) =>
          this.logger.error(
            `[groups] notify GROUP_OWNERSHIP_TRANSFERRED (new owner) failed for ${newOwnerId}, group ${groupId}: ${err.message}`,
            'GroupService',
          ),
        ),
      this.notificationService
        .notify(groupOwnershipTransferredFromOldOwner(currentOwnerId, groupRef))
        .catch((err: Error) =>
          this.logger.error(
            `[groups] notify GROUP_OWNERSHIP_TRANSFERRED (old owner) failed for ${currentOwnerId}, group ${groupId}: ${err.message}`,
            'GroupService',
          ),
        ),
      newOwnerUser?.email
        ? this.emailService
            .sendGroupOwnershipTransferredEmail({
              to: newOwnerUser.email,
              direction: 'received',
              recipientFirstName: newOwnerUser.firstName,
              otherPartyName: oldOwnerName,
              groupName: group.name,
              groupId: group.id,
              locale: toLocale(newOwnerUser.language),
            })
            .catch((err: Error) =>
              this.logger.error(
                `[groups] sendGroupOwnershipTransferredEmail (received) failed for ${newOwnerId}, group ${groupId}: ${err.message}`,
                'GroupService',
              ),
            )
        : Promise.resolve(),
      oldOwnerUser?.email
        ? this.emailService
            .sendGroupOwnershipTransferredEmail({
              to: oldOwnerUser.email,
              direction: 'transferred',
              recipientFirstName: oldOwnerUser.firstName,
              otherPartyName: newOwnerName,
              groupName: group.name,
              groupId: group.id,
              locale: toLocale(oldOwnerUser.language),
            })
            .catch((err: Error) =>
              this.logger.error(
                `[groups] sendGroupOwnershipTransferredEmail (transferred) failed for ${currentOwnerId}, group ${groupId}: ${err.message}`,
                'GroupService',
              ),
            )
        : Promise.resolve(),
    ]);

    // The search doc names the owner: a stale one would drop the group from
    // search when the previous owner deletes their account.
    await this.refreshSearch(groupId);
    return { message: 'Ownership transferred successfully' };
  }

  /**
   * Get group statistics (member count, session count, etc.)
   */
  async getGroupStats(
    groupId: string,
    userId: string,
  ): Promise<{
    memberCount: number;
    sessionCount: number;
    upcomingSessionCount: number;
    completedSessionCount: number;
  }> {
    await this.assertMember(groupId, userId);

    const [
      memberCount,
      sessionCount,
      upcomingSessionCount,
      completedSessionCount,
    ] = await Promise.all([
      this.memberModel.count({ where: { groupId, leftAt: null } }),
      SessionInstance.count({
        include: [
          {
            model: SessionTemplate,
            as: 'template',
            where: { groupId },
            required: true,
            attributes: [],
          },
        ],
      }),
      SessionInstance.count({
        where: {
          status: SessionInstanceStatus.Scheduled,
          startAt: { [Op.gte]: new Date() },
        },
        include: [
          {
            model: SessionTemplate,
            as: 'template',
            where: { groupId },
            required: true,
            attributes: [],
          },
        ],
      }),
      SessionInstance.count({
        where: { status: SessionInstanceStatus.Completed },
        include: [
          {
            model: SessionTemplate,
            as: 'template',
            where: { groupId },
            required: true,
            attributes: [],
          },
        ],
      }),
    ]);

    return {
      memberCount,
      sessionCount,
      upcomingSessionCount,
      completedSessionCount,
    };
  }

  /**
   * Assert user is the owner and return the group
   *
   * Used by InvitationService to verify only owners can send invitations.
   *
   * @throws ForbiddenException if user is not a member or not the owner
   * @throws NotFoundException if group not found
   */
  async assertOwnerAndGet(groupId: string, userId: string): Promise<Group> {
    const group = await this.groupModel.findByPk(groupId);
    if (!group) throw new NotFoundException(apiError('group.notFound'));
    await this.assertOwner(groupId, userId);
    return group;
  }

  /**
   * Re-index a group after its members or owner changed, so search shows the
   * right member count and owner. Best effort: the change itself already
   * happened, and a search hiccup must not report it as failed.
   */
  private async refreshSearch(groupId: string): Promise<void> {
    try {
      await this.searchIndexService.upsertGroup(groupId);
    } catch (err) {
      this.logger.warn(
        `Search refresh failed for group ${groupId}: ${err instanceof Error ? err.message : String(err)}`,
        'GroupService',
      );
    }
  }

  /**
   * A person's email or phone as the viewer may see it, by that person's own
   * privacy setting. `null` audience: the viewer may never see it.
   */
  private contactFor(
    user: Pick<User, 'email' | 'phone' | 'privacySettings'>,
    field: 'email' | 'phone',
    audience: PublicProfileAudience | null,
  ): string | null {
    if (!audience) return null;
    const level = resolveLevel(user.privacySettings, field);
    return isFieldVisible(level, audience) ? (user[field] ?? null) : null;
  }

  private async assertMember(
    groupId: string,
    userId: string,
  ): Promise<GroupMember> {
    const member = await this.memberModel.findOne({
      where: { groupId, userId, leftAt: null },
    });

    if (!member) {
      throw new ForbiddenException(apiError('group.notMember'));
    }

    return member;
  }

  private async assertOwner(groupId: string, userId: string): Promise<void> {
    const member = await this.assertMember(groupId, userId);

    if (!member.isOwner) {
      throw new ForbiddenException(apiError('group.ownerOnly'));
    }
  }

  /**
   * Promote a member to MODERATOR or demote back to MEMBER.
   *
   * Only the group OWNER can call this. The OWNER role itself is
   * immutable through this endpoint — owner transfer is the dedicated
   * `transferOwnership` flow with stricter checks (and the partial
   * unique index enforces "at most one OWNER per group").
   */
  async updateMemberRole(
    requestingUserId: string,
    groupId: string,
    targetUserId: string,
    dto: UpdateMemberRoleDto,
  ): Promise<GroupMember> {
    const group = await this.assertOwnerAndGet(groupId, requestingUserId);

    if (requestingUserId === targetUserId) {
      throw new BadRequestException(apiError('group.cannotChangeOwnRole'));
    }

    const target = await this.memberModel.findOne({
      where: { groupId, userId: targetUserId, leftAt: null },
    });
    if (!target) {
      throw new NotFoundException(apiError('group.targetNotMember'));
    }
    if (target.role === GroupMemberRole.OWNER) {
      throw new ForbiddenException(apiError('group.cannotChangeOwnerRole'));
    }

    const newRole =
      dto.role === AssignableMemberRole.MODERATOR
        ? GroupMemberRole.MODERATOR
        : GroupMemberRole.MEMBER;

    if (target.role === newRole) {
      return target;
    }

    const oldRole = target.role;
    await target.update({ role: newRole });

    // Tell the affected member their role changed. Best-effort.
    await this.notificationService
      .notify(
        groupMemberRoleChanged(
          targetUserId,
          { id: group.id, name: group.name },
          newRole,
        ),
      )
      .catch((err: Error) =>
        this.logger.error(
          `[groups] notify GROUP_MEMBER_ROLE_CHANGED failed for user ${targetUserId}, group ${groupId}: ${err.message}`,
          'GroupService',
        ),
      );

    // Email the member too. The notify call covers the bell; this
    // covers the inbox. Roles go in as enum values; the email words
    // them in the reader's language.
    const member = await this.userModel.findByPk(targetUserId, {
      attributes: ['email', 'firstName', 'language'],
    });
    if (member?.email) {
      this.emailService
        .sendGroupRoleChangedEmail({
          to: member.email,
          memberFirstName: member.firstName,
          groupName: group.name,
          groupId: group.id,
          oldRole,
          newRole,
          locale: toLocale(member.language),
        })
        .catch((err: Error) =>
          this.logger.error(
            `[groups] sendGroupRoleChangedEmail failed for user ${targetUserId}, group ${groupId}: ${err.message}`,
            'GroupService',
          ),
        );
    }

    return target;
  }
}
