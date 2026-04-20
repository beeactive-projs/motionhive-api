import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op, Sequelize, Transaction, literal } from 'sequelize';
import { Group, JoinPolicy } from './entities/group.entity';
import { GroupMember } from './entities/group-member.entity';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { DiscoverGroupsDto } from './dto/discover-groups.dto';
import { User } from '../user/entities/user.entity';
import { Session } from '../session/entities/session.entity';
import { InstructorProfile } from '../profile/entities/instructor-profile.entity';
import { InstructorClient } from '../client/entities/instructor-client.entity';
import { EmailService } from '../../common/services/email.service';
import { CryptoService } from '../../common/services/crypto.service';
import { buildPaginatedResponse } from '../../common/dto/pagination.dto';
import { buildSearchTerm } from '../../common/utils/search.utils';

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
@Injectable()
export class GroupService {
  constructor(
    @InjectModel(Group)
    private groupModel: typeof Group,
    @InjectModel(GroupMember)
    private memberModel: typeof GroupMember,
    @InjectModel(InstructorClient)
    private instructorClientModel: typeof InstructorClient,
    private emailService: EmailService,
    private cryptoService: CryptoService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
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
            tags: dto.tags,
            contactEmail: dto.contactEmail,
            contactPhone: dto.contactPhone,
            address: dto.address,
            city: dto.city,
            country: dto.country,
            memberCount: 1, // Owner counts as first member
          },
          { transaction },
        );

        // Add creator as owner member
        await this.memberModel.create(
          {
            groupId: group.id,
            userId: userId,
            isOwner: true,
          },
          { transaction },
        );

        await transaction.commit();

        this.logger.log(
          `Group created: ${group.name} (${group.id}) by instructor ${userId}`,
          'GroupService',
        );

        return group;
      } catch (error: any) {
        await transaction.rollback();

        // Retry on unique constraint violation (slug collision from concurrent create)
        const isUniqueViolation =
          error.name === 'SequelizeUniqueConstraintError' &&
          error.fields?.slug !== undefined;

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
    throw new BadRequestException('Failed to generate unique slug');
  }

  /**
   * Get all groups the user belongs to (active memberships only)
   */
  async getMyGroups(userId: string): Promise<Group[]> {
    const memberships = await this.memberModel.findAll({
      where: { userId, leftAt: null },
      include: [
        {
          model: Group,
          where: { isActive: true },
        },
      ],
    });

    return memberships.map((m) => m.group);
  }
  /**
   * Get all groups the user belongs to (active memberships only)
   */
  async getInstructorsGroups(instructorId: string): Promise<Group[]> {
    const groups = await this.groupModel.findAll({
      where: { instructorId },
      include: [
        {
          model: GroupMember,
        },
      ],
    });

    return groups;
  }

  /**
   * Get group by ID (only if user is a member)
   *
   * Uses a targeted membership check instead of loading all members.
   */
  async getById(groupId: string, userId: string): Promise<Group> {
    const group = await this.groupModel.findByPk(groupId);

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    // Verify membership with a single targeted query
    // await this.assertMember(groupId, userId);

    return group;
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

    // If name changes, regenerate slug
    if (dto.name && dto.name !== group.name) {
      const baseSlug = this.generateSlug(dto.name);
      const slug = await this.ensureUniqueSlug(baseSlug);
      (dto as any).slug = slug;
    }

    await group.update(dto);
    return group;
  }

  /**
   * Delete group (owner only, soft delete)
   */
  async deleteGroup(groupId: string, userId: string): Promise<void> {
    const group = await this.assertOwnerAndGet(groupId, userId);

    await group.destroy(); // Soft delete (paranoid: true sets deletedAt)

    this.logger.log(
      `Group deleted: ${group.name} (${group.id}) by user ${userId}`,
      'GroupService',
    );
  }

  /**
   * Leave a group voluntarily
   *
   * Owners cannot leave -- they must transfer ownership first or delete the group.
   * Uses a transaction to ensure member update + count decrement are atomic.
   */
  async leaveGroup(groupId: string, userId: string): Promise<void> {
    const member = await this.memberModel.findOne({
      where: { groupId, userId, leftAt: null },
    });

    if (!member) {
      throw new NotFoundException('You are not a member of this group');
    }

    if (member.isOwner) {
      throw new ForbiddenException(
        'Group owner cannot leave. Transfer ownership first or delete the group.',
      );
    }

    const sequelize = this.groupModel.sequelize!;
    const transaction = await sequelize.transaction();

    try {
      await member.update({ leftAt: new Date() }, { transaction });

      // Decrement denormalized member count
      await this.groupModel.decrement('memberCount', {
        where: { id: groupId },
        transaction,
      });

      await transaction.commit();

      this.logger.log(`User ${userId} left group ${groupId}`, 'GroupService');
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
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
    // Verify the requesting user is a member
    // await this.assertMember(groupId, userId);

    const offset = (page - 1) * limit;

    // First, get the group to know the instructor
    const group = await this.groupModel.findByPk(groupId);
    if (!group) {
      throw new NotFoundException('Group not found');
    }

    const { rows: members, count: totalItems } =
      await this.memberModel.findAndCountAll({
        where: { groupId, leftAt: null },
        include: [
          {
            model: User,
            attributes: [
              'id',
              'email',
              'firstName',
              'lastName',
              'phone',
              'avatarId',
            ],
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
        email: member.user.email,
        avatarId: member.user.avatarId,
      },
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
      throw new NotFoundException('You are not a member of this group');
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
    // await this.assertOwner(groupId, userId);

    const member = await this.memberModel.findOne({
      where: { groupId, userId: memberId, leftAt: null },
    });

    if (!member) {
      throw new NotFoundException('Member not found');
    }

    if (member.isOwner) {
      throw new ForbiddenException('Cannot remove the group owner');
    }

    const sequelize = this.groupModel.sequelize!;
    const transaction = await sequelize.transaction();

    try {
      await member.update({ leftAt: new Date() }, { transaction });

      await this.groupModel.decrement('memberCount', {
        where: { id: groupId },
        transaction,
      });

      await transaction.commit();

      this.logger.log(
        `Member ${memberId} removed from group ${groupId} by ${userId}`,
        'GroupService',
      );
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
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
   * No authentication required.
   */
  async discoverGroups(dto: DiscoverGroupsDto) {
    const page = dto.page || 1;
    const limit = dto.limit || 20;
    const offset = (page - 1) * limit;

    const where: any = {
      isPublic: true,
      isActive: true,
    };

    // Filter by tags using PostgreSQL jsonb @> operator
    if (dto.tags && dto.tags.length > 0) {
      const sequelize = this.groupModel.sequelize!;
      const tagConditions = dto.tags.map((tag) =>
        literal(
          `tags::jsonb @> ${sequelize.escape(JSON.stringify([tag]))}::jsonb`,
        ),
      );
      where[Op.and] = [...(where[Op.and] || []), ...tagConditions];
    }

    if (dto.city) {
      where.city = { [Op.iLike]: `%${dto.city}%` };
    }

    if (dto.country) {
      where.country = dto.country;
    }

    if (dto.search) {
      const term = buildSearchTerm(dto.search);
      where[Op.or] = [
        { name: { [Op.iLike]: term } },
        { description: { [Op.iLike]: term } },
      ];
    }

    const { rows: data, count: totalItems } =
      await this.groupModel.findAndCountAll({
        where,
        attributes: [
          'id',
          'name',
          'slug',
          'description',
          'logoUrl',
          'joinPolicy',
          'tags',
          'city',
          'country',
          'memberCount',
          'createdAt',
        ],
        order: [['memberCount', 'DESC']],
        limit,
        offset,
      });

    return buildPaginatedResponse(data, totalItems, page, limit);
  }

  /**
   * Get public profile of a group
   *
   * Returns group details, instructor info, and upcoming public sessions.
   * Visible to anyone -- no membership required.
   */
  async getPublicProfile(groupId: string) {
    const group = await this.groupModel.findOne({
      where: {
        id: groupId,
        isPublic: true,
        isActive: true,
      },
      attributes: [
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
        'memberCount',
        'createdAt',
      ],
    });

    if (!group) {
      throw new NotFoundException('Group not found or is not public');
    }

    // Get the instructor (owner)
    const ownerMembership = await this.memberModel.findOne({
      where: { groupId, isOwner: true, leftAt: null },
      include: [
        {
          model: User,
          attributes: ['id', 'firstName', 'lastName', 'avatarId'],
        },
      ],
    });

    // Get instructor's profile (if public)
    let instructorProfile: any = null;
    if (ownerMembership) {
      const orgProfile = await InstructorProfile.findOne({
        where: { userId: ownerMembership.userId, isPublic: true },
        attributes: [
          'displayName',
          'bio',
          'specializations',
          'yearsOfExperience',
          'isAcceptingClients',
          'locationCity',
          'locationCountry',
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
    const upcomingSessions = await Session.findAll({
      where: {
        instructorId:
          group.getDataValue('instructorId') || ownerMembership?.userId,
        visibility: { [Op.in]: ['PUBLIC', 'GROUP'] },
        status: { [Op.in]: ['SCHEDULED', 'IN_PROGRESS'] },
        scheduledAt: { [Op.gte]: new Date() },
      },
      attributes: [
        'id',
        'title',
        'description',
        'sessionType',
        'visibility',
        'scheduledAt',
        'durationMinutes',
        'location',
        'maxParticipants',
        'price',
        'currency',
        'status',
      ],
      order: [['scheduledAt', 'ASC']],
      limit: 10,
    });

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
   * Self-join a public group
   *
   * Only works if:
   * - Group is public
   * - Join policy is OPEN
   * - User is not already a member
   *
   * Uses a transaction to ensure member creation + count increment are atomic.
   */
  async selfJoinGroup(groupId: string, userId: string): Promise<GroupMember> {
    const group = await this.groupModel.findByPk(groupId);

    if (!group) {
      throw new NotFoundException('Group not found');
    }

    if (!group.isPublic) {
      throw new ForbiddenException(
        'This group is not public. You need an invitation to join.',
      );
    }

    if (group.joinPolicy !== JoinPolicy.OPEN) {
      throw new ForbiddenException(
        `This group requires ${group.joinPolicy === JoinPolicy.INVITE_ONLY ? 'an invitation' : 'approval from the owner'} to join.`,
      );
    }

    // Check if already a member
    const existing = await this.memberModel.findOne({
      where: { groupId, userId, leftAt: null },
    });

    if (existing) {
      throw new BadRequestException('You are already a member of this group');
    }

    const sequelize = this.groupModel.sequelize!;
    const transaction = await sequelize.transaction();

    try {
      const member = await this.memberModel.create(
        { groupId, userId, isOwner: false },
        { transaction },
      );

      // Update denormalized member count
      await this.groupModel.increment('memberCount', {
        where: { id: groupId },
        transaction,
      });

      await transaction.commit();

      this.logger.log(
        `User ${userId} self-joined group ${group.name} (${groupId})`,
        'GroupService',
      );

      return member;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
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

    if (!group) {
      throw new NotFoundException('Invalid or expired join link');
    }

    // Check expiry
    if (
      group.joinTokenExpiresAt &&
      new Date() > new Date(group.joinTokenExpiresAt)
    ) {
      throw new BadRequestException(
        'This join link has expired. Ask the group owner for a new one.',
      );
    }

    // Check if already a member
    const existing = await this.memberModel.findOne({
      where: { groupId: group.id, userId, leftAt: null },
    });

    if (existing) {
      throw new BadRequestException('You are already a member of this group');
    }

    const sequelize = this.groupModel.sequelize!;
    const transaction = await sequelize.transaction();

    try {
      const member = await this.memberModel.create(
        { groupId: group.id, userId, isOwner: false },
        { transaction },
      );

      await this.groupModel.increment('memberCount', {
        where: { id: group.id },
        transaction,
      });

      await transaction.commit();

      this.logger.log(
        `User ${userId} joined group ${group.name} (${group.id}) via join link`,
        'GroupService',
      );

      return member;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  // =====================================================
  // HELPERS (used by other services, e.g. InvitationService)
  // =====================================================

  /**
   * Add a user as a member (used by InvitationService)
   *
   * If already a member, returns existing membership.
   * Otherwise creates a new one and increments memberCount.
   */
  async addMember(
    groupId: string,
    userId: string,
    externalTransaction?: Transaction,
  ): Promise<GroupMember> {
    // Check if already a member
    const existing = await this.memberModel.findOne({
      where: { groupId, userId, leftAt: null },
      ...(externalTransaction ? { transaction: externalTransaction } : {}),
    });

    if (existing) return existing;

    // If caller provides a transaction, use it; otherwise create our own
    const sequelize = this.groupModel.sequelize!;
    const transaction = externalTransaction || (await sequelize.transaction());

    try {
      const member = await this.memberModel.create(
        { groupId, userId, isOwner: false },
        { transaction },
      );

      // Update denormalized member count
      await this.groupModel.increment('memberCount', {
        where: { id: groupId },
        transaction,
      });

      // Only commit if we own the transaction
      if (!externalTransaction) await transaction.commit();
      return member;
    } catch (error) {
      if (!externalTransaction) await transaction.rollback();
      throw error;
    }
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
    await this.assertOwner(groupId, currentOwnerId);

    if (currentOwnerId === newOwnerId) {
      throw new BadRequestException('You are already the owner');
    }

    const newOwnerMember = await this.memberModel.findOne({
      where: { groupId, userId: newOwnerId, leftAt: null },
    });

    if (!newOwnerMember) {
      throw new BadRequestException(
        'New owner must be an active member of the group',
      );
    }

    const sequelize = this.groupModel.sequelize!;
    const transaction = await sequelize.transaction();

    try {
      // Remove owner flag from current owner
      await this.memberModel.update(
        { isOwner: false },
        { where: { groupId, userId: currentOwnerId }, transaction },
      );

      // Set new owner
      await this.memberModel.update(
        { isOwner: true },
        { where: { groupId, userId: newOwnerId }, transaction },
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
      Session.count({ where: { groupId } }),
      Session.count({
        where: {
          groupId,
          status: 'SCHEDULED',
          scheduledAt: { [Op.gte]: new Date() },
        },
      }),
      Session.count({ where: { groupId, status: 'COMPLETED' } }),
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
    if (!group) throw new NotFoundException('Group not found');
    await this.assertOwner(groupId, userId);
    return group;
  }

  private async assertMember(
    groupId: string,
    userId: string,
  ): Promise<GroupMember> {
    const member = await this.memberModel.findOne({
      where: { groupId, userId, leftAt: null },
    });

    if (!member) {
      throw new ForbiddenException('You are not a member of this group');
    }

    return member;
  }

  private async assertOwner(groupId: string, userId: string): Promise<void> {
    const member = await this.assertMember(groupId, userId);

    if (!member.isOwner) {
      throw new ForbiddenException('Only the group owner can do this');
    }
  }
}
