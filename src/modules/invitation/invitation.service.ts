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
import { Invitation } from './entities/invitation.entity';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { GroupService } from '../group/group.service';
import { RoleService } from '../role/role.service';
import { CryptoService, EmailService } from '../../common/services';
import { buildPaginatedResponse } from '../../common/dto/pagination.dto';
import { User } from '../user/entities/user.entity';
import { Group } from '../group/entities/group.entity';
import { Role } from '../role/entities/role.entity';
import { GroupMember } from '../group/entities/group-member.entity';

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
    private invitationModel: typeof Invitation,
    @InjectModel(GroupMember)
    private memberModel: typeof GroupMember,
    private sequelize: Sequelize,
    private groupService: GroupService,
    private roleService: RoleService,
    private cryptoService: CryptoService,
    private emailService: EmailService,
    private configService: ConfigService,
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
      throw new BadRequestException(
        'This user is already a member of the group',
      );
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
      throw new BadRequestException(
        'An active invitation already exists for this email',
      );
    }

    // Generate token — hash it for storage, keep plain for the link
    const plainToken = this.cryptoService.generateToken();
    const hashedToken = this.cryptoService.hashToken(plainToken);

    // Create invitation (expires in 7 days)
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    // Get inviter name for email
    const inviter = await User.findByPk(inviterId, {
      attributes: ['firstName', 'lastName'],
    });
    const inviterName = inviter
      ? `${inviter.firstName} ${inviter.lastName}`
      : 'Group Owner';

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
      )
      .catch((err: Error) =>
        this.logger.error(
          `Failed to send invitation email: ${err.message}`,
          'InvitationService',
        ),
      );

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
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.acceptedAt) {
      throw new BadRequestException('Invitation has already been accepted');
    }

    if (invitation.declinedAt) {
      throw new BadRequestException('Invitation has been declined');
    }

    if (invitation.expiresAt < new Date()) {
      throw new BadRequestException('Invitation has expired');
    }

    // Verify the accepting user's email matches the invitation email
    if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ForbiddenException(
        'This invitation was sent to a different email address',
      );
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

    // Notify the inviter that the invitation was accepted
    // TODO: [NOTIFICATION SYSTEM] Move to notification module when implemented
    const inviterUser = await User.findByPk(invitation.inviterId, {
      attributes: ['email', 'firstName'],
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
          invitation.group?.name || 'your group',
        )
        .catch(() => {});
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
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    if (invitation.acceptedAt || invitation.declinedAt) {
      throw new BadRequestException('Invitation has already been responded to');
    }

    // Verify the declining user's email matches the invitation
    if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new ForbiddenException(
        'This invitation was sent to a different email address',
      );
    }

    await invitation.update({ declinedAt: new Date() });

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
      throw new NotFoundException('Invitation not found');
    }

    // Verify the user is the group owner
    await this.groupService.assertOwnerAndGet(invitation.groupId, userId);

    if (invitation.acceptedAt) {
      throw new BadRequestException(
        'Cannot cancel an already accepted invitation',
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
      throw new NotFoundException('Invitation not found');
    }

    // Verify the user is the group owner
    await this.groupService.assertOwnerAndGet(invitation.groupId, userId);

    if (invitation.acceptedAt) {
      throw new BadRequestException(
        'Cannot resend an already accepted invitation',
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
      attributes: ['firstName', 'lastName'],
    });
    const inviterName = inviter
      ? `${inviter.firstName} ${inviter.lastName}`
      : 'Group Owner';

    // Send email
    this.emailService
      .sendInvitationEmail(
        invitation.email,
        plainToken,
        inviterName,
        invitation.group.name,
        invitation.message,
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
   * List pending invitations for the authenticated user's email
   */
  async getMyPendingInvitations(
    userEmail: string,
    page: number = 1,
    limit: number = 20,
  ) {
    const offset = (page - 1) * limit;

    const { rows: data, count: totalItems } =
      await this.invitationModel.findAndCountAll({
        where: {
          email: userEmail,
          acceptedAt: null,
          declinedAt: null,
        },
        include: [
          {
            model: User,
            as: 'inviter',
            attributes: ['id', 'firstName', 'lastName', 'avatarId'],
          },
          {
            model: Group,
            attributes: ['id', 'name', 'slug'],
          },
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
}
