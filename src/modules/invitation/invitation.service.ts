import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Sequelize } from 'sequelize-typescript';
import { Op, col, fn, literal, where } from 'sequelize';
import { Invitation } from './entities/invitation.entity';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { InviteMembersDto } from './dto/invite-members.dto';
import {
  InstructorClient,
  InstructorClientStatus,
} from '../client/entities/instructor-client.entity';
import { categoryIdsSql } from '../category/category-sql';
import { normalizeEmail } from '../../common/utils/text.utils';
import { GroupService } from '../group/group.service';
import { RoleService } from '../role/role.service';
import { CryptoService, EmailService } from '../../common/services';
import { buildPaginatedResponse } from '../../common/dto/pagination.dto';
import { User } from '../user/entities/user.entity';
import { Group } from '../group/entities/group.entity';
import { Role } from '../role/entities/role.entity';
import { GroupMember } from '../group/entities/group-member.entity';
import { NotificationService } from '../notification/notification.service';
import {
  groupInvitationReceived,
  groupInvitationAccepted,
  groupInvitationDeclined,
  groupInvitationsReceived,
} from '../group/notifications';
import { apiError, toLocale } from '../../common/i18n';
import type { Locale } from '../../common/i18n';

/**
 * How long an invitation answered inside the app stays open: no link
 * travels, so it can wait as long as a client request does.
 */
const IN_APP_INVITATION_DAYS = 30;

/** Members of the invited group, over the `group` alias of the include. */
const INVITED_GROUP_MEMBER_COUNT_SQL =
  '(SELECT COUNT(*)::int FROM group_member gm WHERE gm.group_id = "group"."id" AND gm.left_at IS NULL)';

/** What the invited group trains, over the same alias. */
const INVITED_GROUP_CATEGORY_IDS_SQL = categoryIdsSql('group', '"group"."id"');

/** One of my invitations as the invite card reads it. */
export interface PendingInvitation {
  id: string;
  message: string | null;
  createdAt: Date;
  expiresAt: Date;
  inviter: {
    id: string;
    firstName: string;
    lastName: string;
    handle: string | null;
    avatarUrl: string | null;
  } | null;
  group: {
    id: string;
    name: string;
    slug: string;
    logoUrl: string | null;
    description: string | null;
    memberCount: number;
    categoryIds: string[];
  };
}

/** Whether two addresses are the same mailbox, whatever their case. */
function sameEmail(a: string, b: string): boolean {
  return normalizeEmail(a) === normalizeEmail(b);
}

/** An invitation row, with its includes, in the card's shape. */
function toPendingInvitation(row: Invitation): PendingInvitation {
  const group = row.group;
  let inviter: PendingInvitation['inviter'] = null;
  if (row.inviter) {
    inviter = {
      id: row.inviter.id,
      firstName: row.inviter.firstName,
      lastName: row.inviter.lastName,
      handle: row.inviter.handle ?? null,
      avatarUrl: row.inviter.avatarUrl ?? null,
    };
  }
  let categoryIds: string[] = [];
  const rawCategoryIds: unknown = group.getDataValue(
    'categoryIds' as keyof typeof group,
  );
  if (Array.isArray(rawCategoryIds)) {
    categoryIds = rawCategoryIds as string[];
  }
  return {
    id: row.id,
    message: row.message ?? null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    inviter,
    group: {
      id: group.id,
      name: group.name,
      slug: group.slug,
      logoUrl: group.logoUrl ?? null,
      description: group.description ?? null,
      memberCount: Number(
        group.getDataValue('memberCount' as keyof typeof group) ?? 0,
      ),
      categoryIds,
    },
  };
}

/**
 * Invitation Service
 *
 * Manages invitations to join groups.
 *
 * Flow:
 * 1. Instructor sends invitation → token generated (hashed) + email sent
 * 2. Invitee clicks link → token validated
 * 3. If valid + email matches → invitee added as group member + role assigned
 */
@Injectable()
export class InvitationService {
  constructor(
    @InjectModel(Invitation)
    private readonly invitationModel: typeof Invitation,
    @InjectModel(GroupMember)
    private readonly memberModel: typeof GroupMember,
    @InjectModel(InstructorClient)
    private readonly instructorClientModel: typeof InstructorClient,
    private readonly sequelize: Sequelize,
    private readonly groupService: GroupService,
    private readonly roleService: RoleService,
    private readonly cryptoService: CryptoService,
    private readonly emailService: EmailService,
    private readonly configService: ConfigService,
    private readonly notificationService: NotificationService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  /**
   * Send an invitation
   *
   * Generates a hashed token, stores the hash in DB, sends the plain token via email.
   */
  async create(
    inviterId: string,
    dto: CreateInvitationDto,
  ): Promise<{ invitation: Invitation; invitationLink?: string }> {
    // Verify inviter is the OWNER of the group
    const group = await this.groupService.assertOwnerAndGet(
      dto.groupId,
      inviterId,
    );

    // Check if the invited email is already a member
    const existingMember = await this.memberModel.findOne({
      where: {
        groupId: dto.groupId,
        leftAt: null,
      },
      include: [
        {
          model: User,
          where: { email: dto.email },
          attributes: ['id', 'email'],
        },
      ],
    });

    if (existingMember) {
      throw new BadRequestException(apiError('invitation.alreadyMember'));
    }

    // Find the role to assign
    const roleName = dto.roleName || 'USER';
    const role = await this.roleService.findByName(roleName);

    // Check for existing pending invitation
    const existing = await this.invitationModel.findOne({
      where: {
        email: dto.email,
        groupId: dto.groupId,
        acceptedAt: null,
        declinedAt: null,
      },
    });

    if (existing && existing.expiresAt > new Date()) {
      throw new BadRequestException(apiError('invitation.alreadyInvited'));
    }

    // Generate token — hash it for storage, keep plain for the link
    const plainToken = this.cryptoService.generateToken();
    const hashedToken = this.cryptoService.hashToken(plainToken);

    // Create invitation (expires in 7 days)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Get inviter name for email
    const inviter = await User.findByPk(inviterId, {
      attributes: ['firstName', 'lastName', 'language'],
    });
    const inviterName = inviter
      ? `${inviter.firstName} ${inviter.lastName}`
      : null;

    const invitation = await this.invitationModel.create({
      inviterId: inviterId,
      email: dto.email,
      roleId: role.id,
      groupId: dto.groupId,
      token: hashedToken, // Store HASHED token
      message: dto.message,
      expiresAt: expiresAt,
    });

    // Build invitation link with PLAIN token
    const frontendUrl =
      this.configService.get('FRONTEND_URL') || 'http://localhost:4200';
    const invitationLink = `${frontendUrl}/accept-invitation?token=${plainToken}`;

    // Send invitation email
    this.emailService
      .sendInvitationEmail(
        dto.email,
        plainToken,
        inviterName,
        group.name,
        dto.message,
        await this.localeForEmail(dto.email, inviter?.language),
      )
      .catch((err: Error) =>
        this.logger.error(
          `Failed to send invitation email: ${err.message}`,
          'InvitationService',
        ),
      );

    // If the invitee already has an account, drop a bell notification
    // alongside the email. Unregistered emails get email only — there's
    // no userId to address yet.
    const invitee = await User.findOne({
      where: { email: dto.email },
      attributes: ['id'],
    });
    if (invitee) {
      await this.notificationService
        .notify(
          groupInvitationReceived(
            invitee.id,
            { id: group.id, name: group.name },
            inviterName,
          ),
        )
        .catch((err: Error) =>
          this.logger.error(
            `Failed to notify invitee on group invitation: ${err.message}`,
            'InvitationService',
          ),
        );
    }

    this.logger.log(
      `Invitation sent to ${dto.email} for group ${group.name}`,
      'InvitationService',
    );

    // In dev, return the plain token link for testing
    const isProduction = this.configService.get('NODE_ENV') === 'production';

    return {
      invitation,
      ...(isProduction ? {} : { invitationLink }),
    };
  }

  /**
   * Accept an invitation
   *
   * Validates the token (by hashing and comparing), checks email match,
   * adds user to group, assigns role.
   */
  async accept(
    plainToken: string,
    userId: string,
    userEmail: string,
  ): Promise<{ message: string; groupId: string }> {
    const hashedToken = this.cryptoService.hashToken(plainToken);

    const invitation = await this.invitationModel.findOne({
      where: { token: hashedToken },
      include: [Group, Role],
    });

    if (!invitation) {
      throw new NotFoundException(apiError('invitation.notFound'));
    }

    return this.acceptInvitation(invitation, userId, userEmail);
  }

  /**
   * Accept one of my invitations from inside the app (the invite card), by
   * its id: the plain token only ever travels in an email. An invitation
   * sent to someone else answers 404, so an id never confirms it exists.
   */
  async acceptMine(
    invitationId: string,
    userId: string,
    userEmail: string,
  ): Promise<{ message: string; groupId: string }> {
    const invitation = await this.invitationModel.findByPk(invitationId, {
      include: [Group, Role],
    });
    if (!invitation || !sameEmail(invitation.email, userEmail)) {
      throw new NotFoundException(apiError('invitation.notFound'));
    }
    return this.acceptInvitation(invitation, userId, userEmail);
  }

  /** Decline one of my invitations from inside the app, by its id. */
  async declineMine(
    invitationId: string,
    userEmail: string,
  ): Promise<{ message: string }> {
    const invitation = await this.invitationModel.findByPk(invitationId, {
      include: [{ model: Group, attributes: ['id', 'name'] }],
    });
    if (!invitation || !sameEmail(invitation.email, userEmail)) {
      throw new NotFoundException(apiError('invitation.notFound'));
    }
    return this.declineInvitation(invitation, userEmail);
  }

  /** The checks and writes behind both ways of accepting. */
  private async acceptInvitation(
    invitation: Invitation,
    userId: string,
    userEmail: string,
  ): Promise<{ message: string; groupId: string }> {
    if (invitation.acceptedAt) {
      throw new BadRequestException(apiError('invitation.alreadyAccepted'));
    }

    if (invitation.declinedAt) {
      throw new BadRequestException(apiError('invitation.declined'));
    }

    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException(apiError('invitation.expired'));
    }

    // Verify the accepting user's email matches the invitation email
    if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ForbiddenException(apiError('invitation.wrongEmail'));
    }

    // Wrap in transaction: addMember + assignRole + markAccepted must all succeed or all fail
    const transaction = await this.sequelize.transaction();
    try {
      // Add user to group (pass transaction so it participates)
      await this.groupService.addMember(
        invitation.groupId,
        userId,
        transaction,
      );

      // Assign role (group-scoped)
      await this.roleService.assignRoleToUser(
        userId,
        invitation.roleId,
        invitation.groupId,
        undefined,
        transaction,
      );

      // Mark as accepted
      await invitation.update({ acceptedAt: new Date() }, { transaction });

      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }

    this.logger.log(
      `Invitation accepted: user ${userId} joined group ${invitation.groupId}`,
      'InvitationService',
    );

    // Email + bell notification for the inviter.
    const inviterUser = await User.findByPk(invitation.inviterId, {
      attributes: ['email', 'firstName', 'language'],
    });
    const acceptingUser = await User.findByPk(userId, {
      attributes: ['firstName', 'lastName'],
    });
    if (inviterUser && acceptingUser) {
      const accepterName = `${acceptingUser.firstName} ${acceptingUser.lastName}`;
      this.emailService
        .sendInvitationAcceptedEmail(
          inviterUser.email,
          inviterUser.firstName,
          accepterName,
          invitation.group?.name ?? null,
          toLocale(inviterUser.language),
        )
        .catch((err: unknown) =>
          this.logger.warn(
            `Failed to send invitation-accepted email to ${inviterUser.email}: ${(err as Error).message}`,
            'InvitationService',
          ),
        );
      // notify-after-commit: the addMember + assignRole + markAccepted
      // tx already committed above. Do NOT hoist this inside the tx
      // block — a rollback would orphan the "invitation accepted" alert.
      await this.notificationService
        .notify(
          groupInvitationAccepted(
            invitation.inviterId,
            {
              id: invitation.groupId,
              name: invitation.group?.name ?? null,
            },
            accepterName.trim() || null,
          ),
        )
        .catch((err: Error) =>
          this.logger.error(
            `Failed to notify inviter on invitation accepted: ${err.message}`,
            'InvitationService',
          ),
        );
    }

    return {
      message: 'Invitation accepted successfully',
      groupId: invitation.groupId,
    };
  }

  /**
   * Decline an invitation
   *
   * Requires the declining user's email to match the invitation email,
   * preventing unauthorized users from declining someone else's invitation.
   */
  async decline(
    plainToken: string,
    userEmail: string,
  ): Promise<{ message: string }> {
    const hashedToken = this.cryptoService.hashToken(plainToken);

    const invitation = await this.invitationModel.findOne({
      where: { token: hashedToken },
      include: [{ model: Group, attributes: ['id', 'name'] }],
    });

    if (!invitation) {
      throw new NotFoundException(apiError('invitation.notFound'));
    }

    return this.declineInvitation(invitation, userEmail);
  }

  /** The checks and writes behind both ways of declining. */
  private async declineInvitation(
    invitation: Invitation,
    userEmail: string,
  ): Promise<{ message: string }> {
    if (invitation.acceptedAt || invitation.declinedAt) {
      throw new BadRequestException(apiError('invitation.alreadyAnswered'));
    }

    // Verify the declining user's email matches the invitation
    if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ForbiddenException(apiError('invitation.wrongEmail'));
    }

    await invitation.update({ declinedAt: new Date() });

    // Notify the inviter so they don't keep wondering. We deliberately
    // do NOT echo the invitee's email back to the inviter — even though
    // they sent the invite, surfacing the email confirms the person
    // signed up under it (or did the email lookup) and makes the bell
    // a vector for address harvesting. Resolve a display name via the
    // User row if one exists; otherwise pass null and let the builder
    // render a generic "A user" fallback.
    const invitee = await User.findOne({
      where: { email: invitation.email },
      attributes: ['firstName', 'lastName'],
    });
    const inviteeName =
      [invitee?.firstName, invitee?.lastName]
        .filter(Boolean)
        .join(' ')
        .trim() || null;
    await this.notificationService
      .notify(
        groupInvitationDeclined(
          invitation.inviterId,
          {
            id: invitation.groupId,
            name: invitation.group?.name ?? null,
          },
          inviteeName,
        ),
      )
      .catch((err: Error) =>
        this.logger.error(
          `Failed to notify inviter on invitation declined: ${err.message}`,
          'InvitationService',
        ),
      );

    // Email the inviter too. Resolve their email + a display name to
    // mirror the accept path; same address-harvesting concern applies,
    // so if we can't resolve the invitee's name we pass a generic
    // "A user" fallback rather than echoing the invitee's email.
    const inviterUser = await User.findByPk(invitation.inviterId, {
      attributes: ['email', 'firstName', 'lastName', 'language'],
    });
    if (inviterUser?.email && invitation.group?.name) {
      const inviterDisplayName =
        [inviterUser.firstName, inviterUser.lastName]
          .filter(Boolean)
          .join(' ')
          .trim() || null;
      this.emailService
        .sendGroupInvitationDeclinedEmail(
          inviterUser.email,
          inviterDisplayName,
          // null, not a stand-in word: the email words a missing name
          // itself, in the reader's language.
          inviteeName ?? null,
          invitation.group.name,
          toLocale(inviterUser.language),
        )
        .catch((err: Error) =>
          this.logger.error(
            `Failed to send invitation-declined email to ${inviterUser.email}: ${err.message}`,
            'InvitationService',
          ),
        );
    }

    return { message: 'Invitation declined' };
  }

  /**
   * Cancel an invitation (group owner)
   */
  async cancel(
    invitationId: string,
    userId: string,
  ): Promise<{ message: string }> {
    const invitation = await this.invitationModel.findByPk(invitationId);

    if (!invitation) {
      throw new NotFoundException(apiError('invitation.notFound'));
    }

    // Verify the user is the group owner
    await this.groupService.assertOwnerAndGet(invitation.groupId, userId);

    if (invitation.acceptedAt) {
      throw new BadRequestException(
        apiError('invitation.cannotCancelAccepted'),
      );
    }

    // Mark as declined (cancelled by owner)
    await invitation.update({ declinedAt: new Date() });

    this.logger.log(
      `Invitation ${invitationId} cancelled by owner ${userId}`,
      'InvitationService',
    );

    return { message: 'Invitation cancelled' };
  }

  /**
   * Resend an invitation email (group owner)
   *
   * Generates a new token and sends a new email. Old token is invalidated.
   */
  async resend(
    invitationId: string,
    userId: string,
  ): Promise<{ message: string; invitationLink?: string }> {
    const invitation = await this.invitationModel.findByPk(invitationId, {
      include: [Group],
    });

    if (!invitation) {
      throw new NotFoundException(apiError('invitation.notFound'));
    }

    // Verify the user is the group owner
    await this.groupService.assertOwnerAndGet(invitation.groupId, userId);

    if (invitation.acceptedAt) {
      throw new BadRequestException(
        apiError('invitation.cannotResendAccepted'),
      );
    }

    // Generate new token
    const plainToken = this.cryptoService.generateToken();
    const hashedToken = this.cryptoService.hashToken(plainToken);

    // Extend expiry
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Update invitation with new token and expiry
    await invitation.update({
      token: hashedToken,
      expiresAt,
      declinedAt: null, // Clear declined status if it was declined
    });

    // Get inviter name
    const inviter = await User.findByPk(invitation.inviterId, {
      attributes: ['firstName', 'lastName', 'language'],
    });
    const inviterName = inviter
      ? `${inviter.firstName} ${inviter.lastName}`
      : null;

    // Send email
    this.emailService
      .sendInvitationEmail(
        invitation.email,
        plainToken,
        inviterName,
        invitation.group.name,
        invitation.message ?? undefined,
        await this.localeForEmail(invitation.email, inviter?.language),
      )
      .catch((err: Error) =>
        this.logger.error(
          `Failed to resend invitation email: ${err.message}`,
          'InvitationService',
        ),
      );

    const frontendUrl =
      this.configService.get('FRONTEND_URL') || 'http://localhost:4200';
    const invitationLink = `${frontendUrl}/accept-invitation?token=${plainToken}`;
    const isProduction = this.configService.get('NODE_ENV') === 'production';

    this.logger.log(
      `Invitation ${invitationId} resent to ${invitation.email}`,
      'InvitationService',
    );

    return {
      message: 'Invitation resent',
      ...(isProduction ? {} : { invitationLink }),
    };
  }

  /**
   * My invitations still waiting on an answer, newest first, as the invite
   * card shows them: who asked, the group (name, picture, description,
   * member count, what it trains) and their note. Expired invitations and
   * closed groups are left out, the inviter is named without their email or
   * phone, and the stored token never leaves.
   */
  async getMyPendingInvitations(
    userEmail: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const offset = (page - 1) * limit;

    const { rows, count: totalItems } =
      await this.invitationModel.findAndCountAll({
        where: {
          [Op.and]: [
            where(
              fn('lower', col('Invitation.email')),
              normalizeEmail(userEmail),
            ),
          ],
          acceptedAt: null,
          declinedAt: null,
          expiresAt: { [Op.gt]: new Date() },
        },
        include: [
          {
            model: User,
            as: 'inviter',
            attributes: ['id', 'firstName', 'lastName', 'handle', 'avatarUrl'],
          },
          {
            model: Group,
            required: true,
            where: { isActive: true },
            attributes: [
              'id',
              'name',
              'slug',
              'logoUrl',
              'description',
              [literal(INVITED_GROUP_MEMBER_COUNT_SQL), 'memberCount'],
              [literal(INVITED_GROUP_CATEGORY_IDS_SQL), 'categoryIds'],
            ],
          },
        ],
        order: [['createdAt', 'DESC']],
        limit,
        offset,
        distinct: true,
      });

    const data = rows.map((row) => toPendingInvitation(row));
    return buildPaginatedResponse(data, totalItems, page, limit);
  }

  /**
   * Invite several of my clients to my group at once: the client group
   * setup on Home and Invite people on a group. Each person gets one
   * notification and answers inside the app, so no email or link goes out.
   * Members and people with an invitation still open are skipped.
   */
  async inviteMembers(
    inviterId: string,
    dto: InviteMembersDto,
  ): Promise<{ invited: number; skipped: number }> {
    const group = await this.groupService.assertOwnerAndGet(
      dto.groupId,
      inviterId,
    );
    const userIds = dto.userIds.filter((id) => id !== inviterId);
    if (userIds.length !== dto.userIds.length) {
      throw new BadRequestException(apiError('invitation.cannotInviteSelf'));
    }

    // Only the owner's own clients: the setup lists nobody else, and an id
    // picked from anywhere else would let a coach notify strangers.
    const clients = await this.instructorClientModel.findAll({
      where: {
        instructorId: inviterId,
        clientId: { [Op.in]: userIds },
        status: InstructorClientStatus.ACTIVE,
      },
      attributes: ['clientId'],
    });
    if (clients.length !== userIds.length) {
      throw new ForbiddenException(apiError('invitation.notYourClients'));
    }

    const users = await User.findAll({
      where: { id: { [Op.in]: userIds } },
      attributes: ['id', 'email'],
    });
    const members = await this.memberModel.findAll({
      where: {
        groupId: group.id,
        userId: { [Op.in]: userIds },
        leftAt: null,
      },
      attributes: ['userId'],
    });
    const memberIds = new Set(members.map((member) => member.userId));
    const emails = users.map((user) => normalizeEmail(user.email));
    const open = await this.invitationModel.findAll({
      where: {
        groupId: group.id,
        [Op.and]: [where(fn('lower', col('email')), { [Op.in]: emails })],
        acceptedAt: null,
        declinedAt: null,
        expiresAt: { [Op.gt]: new Date() },
      },
      attributes: ['email'],
    });
    const invitedEmails = new Set(
      open.map((invitation) => normalizeEmail(invitation.email)),
    );

    const toInvite = users.filter((user) => {
      if (memberIds.has(user.id)) {
        return false;
      }
      return !invitedEmails.has(normalizeEmail(user.email));
    });
    const skipped = userIds.length - toInvite.length;
    if (toInvite.length === 0) {
      return { invited: 0, skipped };
    }

    const role = await this.roleService.findByName('USER');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + IN_APP_INVITATION_DAYS);

    await this.sequelize.transaction(async (transaction) => {
      await this.invitationModel.bulkCreate(
        toInvite.map((user) => ({
          inviterId,
          email: normalizeEmail(user.email),
          roleId: role.id,
          groupId: group.id,
          // Never sent anywhere: an in-app invitation is answered by id. The
          // column still needs a unique value.
          token: this.cryptoService.hashToken(
            this.cryptoService.generateToken(),
          ),
          expiresAt,
        })),
        { transaction },
      );
    });

    // notify-after-commit: the invitations exist before anyone is told.
    const inviter = await User.findByPk(inviterId, {
      attributes: ['firstName', 'lastName'],
    });
    let inviterName: string | null = null;
    if (inviter) {
      inviterName =
        `${inviter.firstName ?? ''} ${inviter.lastName ?? ''}`.trim() || null;
    }
    await this.notificationService
      .notifyMany(
        toInvite.map((user) => user.id),
        groupInvitationsReceived(
          { id: group.id, name: group.name },
          inviterName,
        ),
      )
      .catch((err: Error) =>
        this.logger.error(
          `Failed to notify invitees for group ${group.id}: ${err.message}`,
          'InvitationService',
        ),
      );

    this.logger.log(
      `Invited ${toInvite.length} clients to group ${group.id} (${skipped} skipped)`,
      'InvitationService',
    );
    return { invited: toInvite.length, skipped };
  }

  /**
   * List invitations for a group
   */
  async getGroupInvitations(
    groupId: string,
    userId: string,
    page: number = 1,
    limit: number = 20,
  ) {
    // Verify user is the group owner (only owners should see all invitations)
    await this.groupService.assertOwnerAndGet(groupId, userId);

    const offset = (page - 1) * limit;

    const { rows: data, count: totalItems } =
      await this.invitationModel.findAndCountAll({
        where: { groupId: groupId },
        include: [
          {
            model: Role,
            attributes: ['id', 'name', 'displayName'],
          },
        ],
        order: [['createdAt', 'DESC']],
        limit,
        offset,
        distinct: true,
      });

    return buildPaginatedResponse(data, totalItems, page, limit);
  }

  /**
   * The language to write to an email address in. An invitation can go
   * to someone with an account (use theirs) or without one (use the
   * inviter's, the best guess for someone they know).
   */
  private async localeForEmail(
    email: string,
    inviterLanguage: string | undefined,
  ): Promise<Locale> {
    const recipient = await User.findOne({
      where: { email: email.trim().toLowerCase() },
      attributes: ['language'],
    });
    return toLocale(recipient?.language ?? inviterLanguage);
  }
}
