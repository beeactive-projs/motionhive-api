import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op } from 'sequelize';
import { randomBytes } from 'crypto';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import {
  InstructorClient,
  InstructorClientStatus,
  InitiatedBy,
} from './entities/instructor-client.entity';
import {
  ClientRequest,
  ClientRequestType,
  ClientRequestStatus,
} from './entities/client-request.entity';
import { InstructorProfile } from '../profile/entities/instructor-profile.entity';
import { User } from '../user/entities/user.entity';
import { GroupMember } from '../group/entities/group-member.entity';
import { Group } from '../group/entities/group.entity';
import { RoleService } from '../role/role.service';
import { EmailService } from '../../common/services/email.service';
import {
  buildPaginatedResponse,
  PaginatedResponse,
} from '../../common/dto/pagination.dto';

// ---------------------------------------------------------------------------
// Local shape types for getMyClients / enrichWithGroupMemberships
// ---------------------------------------------------------------------------

export interface ClientUserSnapshot {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatarId: number | null;
}

export interface GroupMembershipSnapshot {
  groupId: string;
  groupName: string;
}

export interface ClientRow {
  id: string;
  instructorId: string;
  clientId: string | null;
  status: InstructorClientStatus;
  initiatedBy: InitiatedBy;
  notes: string | null;
  startedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  invitedEmail?: string | null;
  requestType?: ClientRequestType;
  expiresAt?: Date;
  client: ClientUserSnapshot | null;
  groupMemberships: GroupMembershipSnapshot[];
}

/**
 * Client Service
 *
 * Manages instructor-client relationships:
 * - Instructors can invite users to become their clients
 * - Users can request to become an instructor's client
 * - Either party can accept/decline/cancel requests
 * - Instructors can manage notes and archive relationships
 */
@Injectable()
export class ClientService {
  constructor(
    @InjectModel(InstructorClient)
    private instructorClientModel: typeof InstructorClient,
    @InjectModel(ClientRequest)
    private clientRequestModel: typeof ClientRequest,
    @InjectModel(InstructorProfile)
    private instructorProfileModel: typeof InstructorProfile,
    private sequelize: Sequelize,
    private roleService: RoleService,
    private emailService: EmailService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  // =====================================================
  // CLIENT LIST QUERIES
  // =====================================================

  /**
   * Get paginated list of an instructor's clients
   *
   * Eager loads user info and resolves which groups (owned by this instructor)
   * each client belongs to.
   */
  async getMyClients(
    instructorId: string,
    filters: { status?: InstructorClientStatus; page?: number; limit?: number },
  ): Promise<PaginatedResponse<ClientRow>> {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    // PENDING items live in client_request (email invites, user invites, requests).
    if (filters.status === InstructorClientStatus.PENDING) {
      return this.getMyPendingClients(instructorId, page, limit, offset);
    }

    // No filter: fetch all instructor_client rows + pending client_request rows,
    // merge in-memory sorted by createdAt DESC, then paginate.
    if (filters.status === undefined) {
      const [icRows, pendingRows]: [InstructorClient[], ClientRow[]] =
        await Promise.all([
          this.instructorClientModel.findAll({
            where: { instructorId },
            include: [this.clientUserInclude()],
            order: [['createdAt', 'DESC']],
          }),
          this.getRawPendingClients(instructorId),
        ]);

      const enriched = await this.enrichWithGroupMemberships(
        instructorId,
        icRows.map((row) => this.toClientRow(row)),
      );

      const merged = [...enriched, ...pendingRows].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );

      return buildPaginatedResponse(
        merged.slice(offset, offset + limit),
        merged.length,
        page,
        limit,
      );
    }

    // ACTIVE / ARCHIVED: DB-paginated query on instructor_client.
    const { rows, count: totalItems } =
      await this.instructorClientModel.findAndCountAll({
        where: { instructorId, status: filters.status },
        include: [this.clientUserInclude()],
        order: [['createdAt', 'DESC']],
        limit,
        offset,
        distinct: true,
      });

    const data = await this.enrichWithGroupMemberships(
      instructorId,
      rows.map((row) => this.toClientRow(row)),
    );

    return buildPaginatedResponse(data, totalItems, page, limit);
  }

  private clientUserInclude() {
    return {
      model: User,
      as: 'client',
      attributes: ['id', 'firstName', 'lastName', 'email', 'avatarId'],
    };
  }

  private toClientRow(row: InstructorClient): ClientRow {
    return {
      id: row.id,
      instructorId: row.instructorId,
      clientId: row.clientId,
      status: row.status,
      initiatedBy: row.initiatedBy,
      notes: row.notes,
      startedAt: row.startedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      client: row.client
        ? {
            id: row.client.id,
            firstName: row.client.firstName,
            lastName: row.client.lastName,
            email: row.client.email,
            avatarId: row.client.avatarId ?? null,
          }
        : null,
      groupMemberships: [],
    };
  }

  /**
   * Returns all pending items for this instructor from client_request:
   * - Invitations the instructor sent (to registered or unregistered users)
   * - Requests from users wanting to become clients
   * Normalised into the same shape the frontend expects.
   */
  private async getMyPendingClients(
    instructorId: string,
    page: number,
    limit: number,
    offset: number,
  ): Promise<PaginatedResponse<ClientRow>> {
    const where = {
      [Op.or]: [
        // Invitations the instructor sent (both email-only and to registered users)
        {
          fromUserId: instructorId,
          type: ClientRequestType.INSTRUCTOR_TO_CLIENT,
        },
        // Requests from users wanting to be this instructor's client
        {
          toUserId: instructorId,
          type: ClientRequestType.CLIENT_TO_INSTRUCTOR,
        },
      ],
      status: ClientRequestStatus.PENDING,
      expiresAt: { [Op.gt]: new Date() },
    };

    const { rows, count: totalItems } =
      await this.clientRequestModel.findAndCountAll({
        where,
        include: [
          {
            model: User,
            as: 'fromUser',
            attributes: ['id', 'firstName', 'lastName', 'email', 'avatarId'],
          },
          {
            model: User,
            as: 'toUser',
            attributes: ['id', 'firstName', 'lastName', 'email', 'avatarId'],
          },
        ],
        order: [['createdAt', 'DESC']],
        limit,
        offset,
      });

    // Normalise into the same shape as instructor_client rows so the
    // frontend table can render them identically.
    const data = rows.map((row) => {
      const isInstructorInvite =
        row.type === ClientRequestType.INSTRUCTOR_TO_CLIENT;
      const clientUser = isInstructorInvite ? row.toUser : row.fromUser;

      return {
        id: row.id,
        instructorId,
        clientId: clientUser?.id || null,
        status: InstructorClientStatus.PENDING,
        initiatedBy: isInstructorInvite
          ? InitiatedBy.INSTRUCTOR
          : InitiatedBy.CLIENT,
        notes: row.message,
        startedAt: null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        invitedEmail: row.invitedEmail,
        requestType: row.type,
        expiresAt: row.expiresAt,
        client: clientUser
          ? {
              id: clientUser.id,
              firstName: clientUser.firstName,
              lastName: clientUser.lastName,
              email: clientUser.email,
              avatarId: clientUser.avatarId,
            }
          : null,
        groupMemberships: [],
      };
    });

    return buildPaginatedResponse(data, totalItems, page, limit);
  }

  private async getRawPendingClients(
    instructorId: string,
  ): Promise<ClientRow[]> {
    const where = {
      [Op.or]: [
        {
          fromUserId: instructorId,
          type: ClientRequestType.INSTRUCTOR_TO_CLIENT,
        },
        {
          toUserId: instructorId,
          type: ClientRequestType.CLIENT_TO_INSTRUCTOR,
        },
      ],
      status: ClientRequestStatus.PENDING,
      expiresAt: { [Op.gt]: new Date() },
    };

    const rows = await this.clientRequestModel.findAll({
      where,
      include: [
        {
          model: User,
          as: 'fromUser',
          attributes: ['id', 'firstName', 'lastName', 'email', 'avatarId'],
        },
        {
          model: User,
          as: 'toUser',
          attributes: ['id', 'firstName', 'lastName', 'email', 'avatarId'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });

    return rows.map((row): ClientRow => {
      const isInstructorInvite =
        row.type === ClientRequestType.INSTRUCTOR_TO_CLIENT;
      const clientUser = isInstructorInvite ? row.toUser : row.fromUser;
      return {
        id: row.id,
        instructorId,
        clientId: clientUser?.id ?? null,
        status: InstructorClientStatus.PENDING,
        initiatedBy: isInstructorInvite
          ? InitiatedBy.INSTRUCTOR
          : InitiatedBy.CLIENT,
        notes: row.message,
        startedAt: null,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        invitedEmail: row.invitedEmail,
        requestType: row.type,
        expiresAt: row.expiresAt,
        client: clientUser
          ? {
              id: clientUser.id,
              firstName: clientUser.firstName,
              lastName: clientUser.lastName,
              email: clientUser.email,
              avatarId: clientUser.avatarId ?? null,
            }
          : null,
        groupMemberships: [],
      };
    });
  }

  /**
   * Enrich client rows with group membership data for groups
   * owned by this instructor.
   */
  private async enrichWithGroupMemberships(
    instructorId: string,
    rows: ClientRow[],
  ): Promise<ClientRow[]> {
    const clientIds = rows.map((r) => r.clientId).filter(Boolean) as string[];
    const groupMembershipsMap: Record<string, GroupMembershipSnapshot[]> = {};

    if (clientIds.length > 0) {
      try {
        const groupMemberships = await GroupMember.findAll({
          where: {
            userId: { [Op.in]: clientIds },
          },
          include: [
            {
              model: Group,
              where: { instructorId },
              attributes: ['id', 'name'],
            },
          ],
          attributes: ['userId'],
        });

        for (const membership of groupMemberships) {
          const userId = membership.getDataValue('userId') as string;
          const group = membership.getDataValue('group') as
            | Pick<Group, 'id' | 'name'>
            | undefined;
          if (!groupMembershipsMap[userId]) {
            groupMembershipsMap[userId] = [];
          }
          groupMembershipsMap[userId].push({
            groupId: group?.id ?? '',
            groupName: group?.name ?? '',
          });
        }
      } catch {
        this.logger.warn(
          'Could not fetch group memberships — group module may not be available',
          'ClientService',
        );
      }
    }

    return rows.map((row) => ({
      ...row,
      groupMemberships: row.clientId
        ? (groupMembershipsMap[row.clientId] ?? [])
        : [],
    }));
  }

  /**
   * Get list of instructors the user is a client of
   *
   * Returns ACTIVE relationships with instructor profile info.
   */
  async getMyInstructors(userId: string): Promise<InstructorClient[]> {
    const relationships = await this.instructorClientModel.findAll({
      where: {
        clientId: userId,
        status: InstructorClientStatus.ACTIVE,
      },
      include: [
        {
          model: User,
          as: 'instructor',
          attributes: ['id', 'firstName', 'lastName', 'email', 'avatarId'],
        },
      ],
      order: [['startedAt', 'DESC']],
    });

    // Enrich with instructor profile info
    const instructorIds = relationships.map((r) => r.instructorId);

    if (instructorIds.length > 0) {
      const profiles = await this.instructorProfileModel.findAll({
        where: { userId: { [Op.in]: instructorIds } },
        attributes: ['userId', 'displayName', 'specializations', 'bio'],
      });

      const profileMap = new Map(
        profiles.map((p) => [p.getDataValue('userId'), p]),
      );

      return relationships.map((rel) => {
        const plain = rel.toJSON();
        const profile = profileMap.get(rel.instructorId);
        plain.instructorProfile = profile ? profile.toJSON() : null;
        return plain;
      });
    }

    return relationships;
  }

  // =====================================================
  // INVITATION / REQUEST FLOW
  // =====================================================

  /**
   * Instructor sends an invitation by email
   *
   * If the email belongs to an existing user, delegates to sendClientInvitation.
   * If not, creates a pending email-only invitation and sends an invite email.
   * When the person later registers with that email, the invitation can be linked.
   */
  async sendClientInvitationByEmail(
    instructorId: string,
    email: string,
    message?: string,
  ): Promise<{ message: string; request: ClientRequest }> {
    const normalizedEmail = email.toLowerCase().trim();

    // Verify the sender has the INSTRUCTOR role
    const hasInstructorRole = await this.roleService.userHasRole(
      instructorId,
      'INSTRUCTOR',
    );
    if (!hasInstructorRole) {
      throw new ForbiddenException(
        'You must have the INSTRUCTOR role to invite clients',
      );
    }

    // Cannot invite yourself
    const instructor = await User.findByPk(instructorId, {
      attributes: ['id', 'email', 'firstName', 'lastName'],
    });
    if (instructor && instructor.email.toLowerCase() === normalizedEmail) {
      throw new BadRequestException('You cannot invite yourself as a client');
    }

    // Check if user exists
    const targetUser = await User.findOne({
      where: { email: normalizedEmail },
      attributes: ['id', 'email', 'firstName'],
    });

    if (targetUser) {
      // User exists - use existing flow
      const request = await this.sendClientInvitation(
        instructorId,
        targetUser.id,
        message,
      );
      return { message: 'Invitation sent to existing user', request };
    }

    // User does NOT exist - create email-only invitation
    // Check no pending email invitation already exists
    const existingRequest = await this.clientRequestModel.findOne({
      where: {
        fromUserId: instructorId,
        invitedEmail: normalizedEmail,
        status: ClientRequestStatus.PENDING,
        expiresAt: { [Op.gt]: new Date() },
      },
    });

    if (existingRequest) {
      throw new ConflictException(
        'A pending invitation already exists for this email',
      );
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const inviteToken = randomBytes(32).toString('hex');

    const request = await this.clientRequestModel.create({
      fromUserId: instructorId,
      toUserId: null,
      invitedEmail: normalizedEmail,
      type: ClientRequestType.INSTRUCTOR_TO_CLIENT,
      message: message || null,
      status: ClientRequestStatus.PENDING,
      token: inviteToken,
      createdAt: new Date(),
      expiresAt,
    });

    // Send invitation email (fire-and-forget)
    const instructorName = instructor
      ? `${instructor.firstName} ${instructor.lastName}`
      : 'An instructor';

    this.emailService
      .sendClientInvitationEmail(
        normalizedEmail,
        instructorName,
        message,
        inviteToken,
      )
      .catch((err: Error) =>
        this.logger.error(
          `Failed to send client invitation email to ${normalizedEmail}: ${err.message}`,
          'ClientService',
        ),
      );

    this.logger.log(
      `Instructor ${instructorId} invited ${normalizedEmail} (not yet registered) as client`,
      'ClientService',
    );

    return { message: 'Invitation sent via email', request };
  }

  /**
   * Instructor sends an invitation to a user to become their client
   *
   * Flow:
   * 1. Verify the sender has the INSTRUCTOR role
   * 2. Check no existing active relationship
   * 3. Check no pending request already exists
   * 4. Create instructor_client record (PENDING)
   * 5. Create client_request record (INSTRUCTOR_TO_CLIENT)
   * 6. Send notification email (fire-and-forget)
   */
  async sendClientInvitation(
    instructorId: string,
    toUserId: string,
    message?: string,
  ): Promise<ClientRequest> {
    // Verify the sender has the INSTRUCTOR role
    const hasInstructorRole = await this.roleService.userHasRole(
      instructorId,
      'INSTRUCTOR',
    );
    if (!hasInstructorRole) {
      throw new ForbiddenException(
        'You must have the INSTRUCTOR role to invite clients',
      );
    }

    // Verify target user exists
    const targetUser = await User.findByPk(toUserId, {
      attributes: ['id', 'email', 'firstName'],
    });
    if (!targetUser) {
      throw new NotFoundException('User not found');
    }

    // Cannot invite yourself
    if (instructorId === toUserId) {
      throw new BadRequestException('You cannot invite yourself as a client');
    }

    // Check no existing active relationship
    await this.assertNoActiveRelationship(instructorId, toUserId);

    // Check no pending request already exists between these two users
    await this.assertNoPendingRequest(instructorId, toUserId);

    // Create the relationship record (PENDING) and request in a transaction
    const result = await this.sequelize.transaction(async (transaction) => {
      // Reuse a prior row for this pair if one exists (e.g. ARCHIVED from
      // an ended collaboration). Resetting it to PENDING keeps a single
      // canonical row per (instructor, client) pair so acceptRequest doesn't
      // see duplicates.
      const existing = await this.instructorClientModel.findOne({
        where: { instructorId, clientId: toUserId },
        transaction,
      });

      if (existing) {
        await existing.update(
          {
            status: InstructorClientStatus.PENDING,
            initiatedBy: InitiatedBy.INSTRUCTOR,
            startedAt: null,
          },
          { transaction },
        );
      } else {
        await this.instructorClientModel.create(
          {
            instructorId,
            clientId: toUserId,
            status: InstructorClientStatus.PENDING,
            initiatedBy: InitiatedBy.INSTRUCTOR,
          },
          { transaction },
        );
      }

      // Create client_request record
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 30);

      const request = await this.clientRequestModel.create(
        {
          fromUserId: instructorId,
          toUserId,
          type: ClientRequestType.INSTRUCTOR_TO_CLIENT,
          message: message || null,
          status: ClientRequestStatus.PENDING,
          createdAt: new Date(),
          expiresAt,
        },
        { transaction },
      );

      return request;
    });

    // Send notification email (fire-and-forget)
    const instructor = await User.findByPk(instructorId, {
      attributes: ['firstName', 'lastName'],
    });
    const instructorName = instructor
      ? `${instructor.firstName} ${instructor.lastName}`
      : 'An instructor';

    this.emailService
      .sendExistingUserClientInvitationEmail(
        targetUser.email,
        targetUser.firstName,
        instructorName,
        result.id,
        message,
      )
      .catch((err: Error) =>
        this.logger.error(
          `Failed to send client invitation email: ${err.message}`,
          'ClientService',
        ),
      );

    this.logger.log(
      `Instructor ${instructorId} invited user ${toUserId} as client`,
      'ClientService',
    );

    return result;
  }

  /**
   * User requests to become an instructor's client
   *
   * Flow:
   * 1. Verify the target has the INSTRUCTOR role
   * 2. Check instructor is accepting clients
   * 3. Check no existing active relationship
   * 4. Check no pending request
   * 5. Create client_request (CLIENT_TO_INSTRUCTOR)
   */
  async requestToBeClient(
    userId: string,
    instructorId: string,
    message?: string,
  ): Promise<ClientRequest> {
    // Verify instructor exists
    const instructor = await User.findByPk(instructorId, {
      attributes: ['id', 'firstName', 'lastName'],
    });
    if (!instructor) {
      throw new NotFoundException('Instructor not found');
    }

    // Cannot request yourself
    if (userId === instructorId) {
      throw new BadRequestException('You cannot request to be your own client');
    }

    // Verify the target has the INSTRUCTOR role
    const hasInstructorRole = await this.roleService.userHasRole(
      instructorId,
      'INSTRUCTOR',
    );
    if (!hasInstructorRole) {
      throw new BadRequestException('The specified user is not an instructor');
    }

    // Check instructor is accepting clients
    const profile = await this.instructorProfileModel.findOne({
      where: { userId: instructorId },
      attributes: ['isAcceptingClients'],
    });

    if (profile && !profile.getDataValue('isAcceptingClients')) {
      throw new BadRequestException(
        'This instructor is not currently accepting new clients',
      );
    }

    // Check no existing active relationship
    await this.assertNoActiveRelationship(instructorId, userId);

    // Check no pending request
    await this.assertNoPendingRequest(instructorId, userId);

    // Create client_request record
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30);

    const request = await this.clientRequestModel.create({
      fromUserId: userId,
      toUserId: instructorId,
      type: ClientRequestType.CLIENT_TO_INSTRUCTOR,
      message: message || null,
      status: ClientRequestStatus.PENDING,
      expiresAt,
    });

    // Notify instructor by email (fire-and-forget)
    const sender = await User.findByPk(userId, {
      attributes: ['email', 'firstName', 'lastName'],
    });
    const instructorEmail = await User.findByPk(instructorId, {
      attributes: ['email'],
    });
    if (sender && instructorEmail) {
      const clientName =
        `${sender.firstName ?? ''} ${sender.lastName ?? ''}`.trim() ||
        sender.email;
      this.emailService
        .sendClientRequestToInstructorEmail(
          instructorEmail.email,
          instructor.firstName,
          clientName,
          request.id,
          message,
        )
        .catch((err: Error) =>
          this.logger.error(
            `Failed to email instructor on new client request: ${err.message}`,
            'ClientService',
          ),
        );
    }

    this.logger.log(
      `User ${userId} requested to become client of instructor ${instructorId}`,
      'ClientService',
    );

    return request;
  }

  /**
   * Accept a pending client request
   *
   * Verifies the current user is the request recipient,
   * then activates the instructor-client relationship.
   */
  async acceptRequest(
    requestId: string,
    userId: string,
  ): Promise<{ message: string }> {
    const request = await this.findRequestOrFail(requestId);

    // Verify the current user is the recipient
    if (request.toUserId !== userId) {
      throw new ForbiddenException('You can only accept requests sent to you');
    }

    // Check not expired
    if (request.expiresAt < new Date()) {
      throw new BadRequestException('This request has expired');
    }

    // Check not already responded
    if (request.status !== ClientRequestStatus.PENDING) {
      throw new BadRequestException(
        `This request has already been ${request.status.toLowerCase()}`,
      );
    }

    // Determine instructor and client based on request type
    const instructorId =
      request.type === ClientRequestType.INSTRUCTOR_TO_CLIENT
        ? request.fromUserId
        : request.toUserId;
    const clientId =
      request.type === ClientRequestType.INSTRUCTOR_TO_CLIENT
        ? request.toUserId
        : request.fromUserId;

    await this.sequelize.transaction(async (transaction) => {
      // Update request status
      await request.update(
        {
          status: ClientRequestStatus.ACCEPTED,
          respondedAt: new Date(),
        },
        { transaction },
      );

      // Create or update instructor_client record to ACTIVE
      const existingRelationship = await this.instructorClientModel.findOne({
        where: { instructorId, clientId },
        transaction,
      });

      if (existingRelationship) {
        await existingRelationship.update(
          {
            status: InstructorClientStatus.ACTIVE,
            startedAt: new Date(),
          },
          { transaction },
        );
      } else {
        await this.instructorClientModel.create(
          {
            instructorId,
            clientId,
            status: InstructorClientStatus.ACTIVE,
            initiatedBy:
              request.type === ClientRequestType.INSTRUCTOR_TO_CLIENT
                ? InitiatedBy.INSTRUCTOR
                : InitiatedBy.CLIENT,
            startedAt: new Date(),
          },
          { transaction },
        );
      }
    });

    // Notify the request sender (fire-and-forget)
    const [sender, responder] = await Promise.all([
      User.findByPk(request.fromUserId, {
        attributes: ['email', 'firstName'],
      }),
      User.findByPk(userId, {
        attributes: ['firstName', 'lastName', 'email'],
      }),
    ]);
    if (sender && responder) {
      const responderName =
        `${responder.firstName ?? ''} ${responder.lastName ?? ''}`.trim() ||
        responder.email;
      this.emailService
        .sendClientRequestAcceptedEmail(
          sender.email,
          sender.firstName,
          responderName,
        )
        .catch((err: Error) =>
          this.logger.error(
            `Failed to email request sender on accept: ${err.message}`,
            'ClientService',
          ),
        );
    }

    this.logger.log(
      `Client request ${requestId} accepted by user ${userId}`,
      'ClientService',
    );

    return { message: 'Request accepted successfully' };
  }

  /**
   * Decline a pending client request
   *
   * Only the request recipient can decline.
   */
  async declineRequest(
    requestId: string,
    userId: string,
  ): Promise<{ message: string }> {
    const request = await this.findRequestOrFail(requestId);

    // Verify the current user is the recipient
    if (request.toUserId !== userId) {
      throw new ForbiddenException('You can only decline requests sent to you');
    }

    if (request.status !== ClientRequestStatus.PENDING) {
      throw new BadRequestException(
        `This request has already been ${request.status.toLowerCase()}`,
      );
    }

    await request.update({
      status: ClientRequestStatus.DECLINED,
      respondedAt: new Date(),
    });

    // If there was a PENDING instructor_client record, remove it
    const instructorId =
      request.type === ClientRequestType.INSTRUCTOR_TO_CLIENT
        ? request.fromUserId
        : request.toUserId;
    const clientId =
      request.type === ClientRequestType.INSTRUCTOR_TO_CLIENT
        ? request.toUserId
        : request.fromUserId;

    await this.instructorClientModel.destroy({
      where: {
        instructorId,
        clientId,
        status: InstructorClientStatus.PENDING,
      },
    });

    // Notify the request sender (fire-and-forget)
    const [sender, responder] = await Promise.all([
      User.findByPk(request.fromUserId, {
        attributes: ['email', 'firstName'],
      }),
      User.findByPk(userId, {
        attributes: ['firstName', 'lastName', 'email'],
      }),
    ]);
    if (sender && responder) {
      const responderName =
        `${responder.firstName ?? ''} ${responder.lastName ?? ''}`.trim() ||
        responder.email;
      this.emailService
        .sendClientRequestDeclinedEmail(
          sender.email,
          sender.firstName,
          responderName,
        )
        .catch((err: Error) =>
          this.logger.error(
            `Failed to email request sender on decline: ${err.message}`,
            'ClientService',
          ),
        );
    }

    this.logger.log(
      `Client request ${requestId} declined by user ${userId}`,
      'ClientService',
    );

    return { message: 'Request declined' };
  }

  /**
   * Cancel a pending client request
   *
   * Only the request sender can cancel.
   */
  async cancelRequest(
    requestId: string,
    userId: string,
  ): Promise<{ message: string }> {
    const request = await this.findRequestOrFail(requestId);

    // Verify the current user is the sender
    if (request.fromUserId !== userId) {
      throw new ForbiddenException('You can only cancel requests you sent');
    }

    if (request.status !== ClientRequestStatus.PENDING) {
      throw new BadRequestException(
        `This request has already been ${request.status.toLowerCase()}`,
      );
    }

    await request.update({
      status: ClientRequestStatus.CANCELLED,
      respondedAt: new Date(),
    });

    // If there was a PENDING instructor_client record, remove it
    const instructorId =
      request.type === ClientRequestType.INSTRUCTOR_TO_CLIENT
        ? request.fromUserId
        : request.toUserId;
    const clientId =
      request.type === ClientRequestType.INSTRUCTOR_TO_CLIENT
        ? request.toUserId
        : request.fromUserId;

    await this.instructorClientModel.destroy({
      where: {
        instructorId,
        clientId,
        status: InstructorClientStatus.PENDING,
      },
    });

    this.logger.log(
      `Client request ${requestId} cancelled by user ${userId}`,
      'ClientService',
    );

    return { message: 'Request cancelled' };
  }

  /**
   * Resend a client invitation
   *
   * Works on PENDING or expired invitations owned by the caller.
   * Refreshes expiresAt (+30 days), regenerates the token for email-only invites,
   * and re-sends the invitation email.
   * Rejects ACCEPTED, DECLINED, and CANCELLED requests.
   */
  async resendInvitation(
    instructorId: string,
    requestId: string,
  ): Promise<{ message: string; request: ClientRequest }> {
    const request = await this.clientRequestModel.findOne({
      where: {
        id: requestId,
        fromUserId: instructorId,
        type: ClientRequestType.INSTRUCTOR_TO_CLIENT,
      },
      include: [
        {
          model: User,
          as: 'toUser',
          attributes: ['id', 'email', 'firstName'],
        },
      ],
    });

    if (!request) {
      throw new NotFoundException('Invitation not found');
    }

    if (
      request.status === ClientRequestStatus.ACCEPTED ||
      request.status === ClientRequestStatus.DECLINED ||
      request.status === ClientRequestStatus.CANCELLED
    ) {
      throw new BadRequestException(
        `Cannot resend an invitation that has already been ${request.status.toLowerCase()}`,
      );
    }

    const newExpiresAt = new Date();
    newExpiresAt.setDate(newExpiresAt.getDate() + 30);

    const newToken = request.invitedEmail
      ? randomBytes(32).toString('hex')
      : request.token;

    await request.update({
      status: ClientRequestStatus.PENDING,
      expiresAt: newExpiresAt,
      token: newToken,
    });

    const instructor = await User.findByPk(instructorId, {
      attributes: ['firstName', 'lastName'],
    });
    const instructorName = instructor
      ? `${instructor.firstName} ${instructor.lastName}`
      : 'An instructor';

    const recipientEmail = request.invitedEmail ?? request.toUser?.email;

    if (recipientEmail) {
      const sendPromise = request.toUserId
        ? this.emailService.sendExistingUserClientInvitationEmail(
            recipientEmail,
            request.toUser?.firstName ?? null,
            instructorName,
            request.id,
            request.message ?? undefined,
          )
        : this.emailService.sendClientInvitationEmail(
            recipientEmail,
            instructorName,
            request.message ?? undefined,
            newToken ?? undefined,
          );

      sendPromise.catch((err: Error) =>
        this.logger.error(
          `Failed to resend client invitation email to ${recipientEmail}: ${err.message}`,
          'ClientService',
        ),
      );
    }

    this.logger.log(
      `Instructor ${instructorId} resent invitation ${requestId}`,
      'ClientService',
    );

    return { message: 'Invitation resent successfully', request };
  }

  // =====================================================
  // CLIENT MANAGEMENT
  // =====================================================

  /**
   * Update an instructor-client relationship
   *
   * Allows updating notes or archiving the relationship.
   * Only the instructor in the relationship can make updates.
   */
  async updateClient(
    instructorId: string,
    clientId: string,
    updates: {
      notes?: string;
      status?: InstructorClientStatus.ACTIVE | InstructorClientStatus.ARCHIVED;
    },
  ): Promise<InstructorClient> {
    const relationship = await this.instructorClientModel.findOne({
      where: { instructorId, clientId },
      include: [
        {
          model: User,
          as: 'instructor',
          attributes: ['id', 'firstName', 'lastName', 'email'],
        },
        {
          model: User,
          as: 'client',
          attributes: ['id', 'firstName', 'lastName', 'email'],
        },
      ],
    });

    if (!relationship) {
      throw new NotFoundException('Client relationship not found');
    }

    const previousStatus = relationship.status;

    const updateData: Partial<Pick<InstructorClient, 'notes' | 'status'>> = {};

    if (updates.notes !== undefined) {
      updateData.notes = updates.notes;
    }

    if (updates.status) {
      updateData.status = updates.status;
    }

    await relationship.update(updateData);

    this.logger.log(
      `Instructor ${instructorId} updated client ${clientId}: ${JSON.stringify(updates)}`,
      'ClientService',
    );

    // Notify both parties when the instructor archives the
    // collaboration. Only fires on the actual transition, so toggling
    // an already-archived row a second time doesn't re-spam emails.
    if (
      updates.status === InstructorClientStatus.ARCHIVED &&
      previousStatus !== InstructorClientStatus.ARCHIVED
    ) {
      this.notifyCollaborationEnded(relationship, 'instructor').catch(
        (err: unknown) =>
          this.logger.warn(
            `Failed to send collaboration-ended emails for ${relationship.id}: ${(err as Error).message}`,
            'ClientService',
          ),
      );
    }

    return relationship;
  }

  /**
   * Client-initiated removal of an instructor relationship.
   * Sets the instructor_client row to ARCHIVED — same terminal state the
   * instructor-side `archiveClient` uses. Caller must own the client side
   * of the relationship.
   *
   * Notification: emails BOTH parties so they each get a record of the
   * change. Active subscriptions are not auto-cancelled by ending the
   * collaboration; the email copy makes that clear so neither party is
   * surprised by the next charge.
   */
  async leaveInstructor(
    clientId: string,
    instructorId: string,
  ): Promise<InstructorClient> {
    // Eager-load both sides' User rows so we can send the emails after
    // the status change without a second round-trip.
    const relationship = await this.instructorClientModel.findOne({
      where: { instructorId, clientId },
      include: [
        {
          model: User,
          as: 'instructor',
          attributes: ['id', 'firstName', 'lastName', 'email'],
        },
        {
          model: User,
          as: 'client',
          attributes: ['id', 'firstName', 'lastName', 'email'],
        },
      ],
    });

    if (!relationship) {
      throw new NotFoundException('Instructor relationship not found');
    }

    if (relationship.status === InstructorClientStatus.ARCHIVED) {
      throw new BadRequestException('Relationship is already archived');
    }

    await relationship.update({ status: InstructorClientStatus.ARCHIVED });

    this.logger.log(
      `Client ${clientId} left instructor ${instructorId}`,
      'ClientService',
    );

    // Fire-and-forget — email failures should never roll back the
    // archive. Both helpers no-op when the email is missing.
    this.notifyCollaborationEnded(relationship, 'client').catch(
      (err: unknown) =>
        this.logger.warn(
          `Failed to send collaboration-ended emails for ${relationship.id}: ${(err as Error).message}`,
          'ClientService',
        ),
    );

    return relationship;
  }

  /**
   * Send the "collaboration ended" email to both parties. `endedBy`
   * names which side initiated, so each recipient sees the right copy
   * ("you ended" vs "they ended"). Silently skips a recipient with no
   * email on file (shouldn't happen for active accounts but cheap to
   * guard).
   */
  private async notifyCollaborationEnded(
    relationship: InstructorClient,
    endedBy: 'instructor' | 'client',
  ): Promise<void> {
    const instructor = relationship.instructor;
    const client = relationship.client;
    if (!instructor || !client) return;

    const instructorName =
      [instructor.firstName, instructor.lastName]
        .filter((s): s is string => !!s)
        .join(' ') || 'Your trainer';
    const clientName =
      [client.firstName, client.lastName]
        .filter((s): s is string => !!s)
        .join(' ') || 'Your client';

    const sends: Promise<void>[] = [];
    if (client.email) {
      sends.push(
        this.emailService.sendCollaborationEndedEmail({
          to: client.email,
          recipientName: client.firstName ?? null,
          otherPartyName: instructorName,
          endedBy: endedBy === 'client' ? 'self' : 'other',
          recipientRole: 'client',
        }),
      );
    }
    if (instructor.email) {
      sends.push(
        this.emailService.sendCollaborationEndedEmail({
          to: instructor.email,
          recipientName: instructor.firstName ?? null,
          otherPartyName: clientName,
          endedBy: endedBy === 'instructor' ? 'self' : 'other',
          recipientRole: 'instructor',
        }),
      );
    }
    await Promise.all(sends);
  }

  // =====================================================
  // HELPER METHODS
  // =====================================================

  /**
   * Check if a user is a client of a specific instructor
   */
  async isClientOf(userId: string, instructorId: string): Promise<boolean> {
    const relationship = await this.instructorClientModel.findOne({
      where: {
        instructorId,
        clientId: userId,
        status: InstructorClientStatus.ACTIVE,
      },
    });

    return !!relationship;
  }

  /**
   * Get pending incoming requests for a user
   *
   * Returns both instructor invitations and client requests
   * that are pending and not expired.
   */
  async getPendingRequests(userId: string): Promise<ClientRequest[]> {
    return this.clientRequestModel.findAll({
      where: {
        toUserId: userId,
        status: ClientRequestStatus.PENDING,
        expiresAt: { [Op.gt]: new Date() },
      },
      include: [
        {
          model: User,
          as: 'fromUser',
          attributes: ['id', 'firstName', 'lastName', 'email', 'avatarId'],
        },
      ],
      order: [['createdAt', 'DESC']],
    });
  }

  // =====================================================
  // TOKEN-BASED INVITE ENDPOINTS
  // =====================================================

  /**
   * Get pending email-only invitations sent by an instructor
   *
   * Returns ClientRequest rows where toUserId IS NULL (person hasn't registered yet).
   * By default only returns non-expired PENDING invites.
   * Pass includeExpired=true to also see expired/cancelled ones.
   */
  async getPendingEmailInvites(
    instructorId: string,
    includeExpired = false,
  ): Promise<ClientRequest[]> {
    const where: {
      fromUserId: string;
      toUserId: null;
      status?: ClientRequestStatus;
      expiresAt?: { [Op.gt]: Date };
    } = {
      fromUserId: instructorId,
      toUserId: null,
    };

    if (!includeExpired) {
      where.status = ClientRequestStatus.PENDING;
      where.expiresAt = { [Op.gt]: new Date() };
    }

    return this.clientRequestModel.findAll({
      where,
      attributes: [
        'id',
        'invitedEmail',
        'message',
        'status',
        'token',
        'createdAt',
        'expiresAt',
      ],
      order: [['createdAt', 'DESC']],
    });
  }

  /**
   * Look up a pending invitation by its referral token
   *
   * Used by the signup page to pre-fill the invited email and show the
   * instructor's name before the user registers.
   *
   * Returns 404 if the token doesn't match any ClientRequest.
   * Returns 410 Gone if the token is expired or already used.
   */
  async getInviteByToken(token: string): Promise<{
    token: string;
    invitedEmail: string;
    instructor: { firstName: string; lastName: string };
    expiresAt: Date;
  }> {
    const request = await this.clientRequestModel.findOne({
      where: { token },
      include: [
        {
          model: User,
          as: 'fromUser',
          attributes: ['firstName', 'lastName'],
        },
      ],
    });

    if (!request) {
      throw new NotFoundException('Invitation not found');
    }

    if (request.status !== ClientRequestStatus.PENDING) {
      throw new GoneException('This invitation has already been used');
    }

    if (request.expiresAt < new Date()) {
      throw new GoneException('This invitation has expired');
    }

    const instructor = request.fromUser;

    return {
      token: request.token as string,
      invitedEmail: request.invitedEmail as string,
      instructor: {
        firstName: instructor.firstName,
        lastName: instructor.lastName,
      },
      expiresAt: request.expiresAt,
    };
  }

  /**
   * Accept an invitation by token (post-registration flow)
   *
   * Called immediately after a new user registers via a referral link.
   * Links the newly created account to the ClientRequest and activates
   * the instructor-client relationship.
   *
   * Returns 404 if the token doesn't match any ClientRequest.
   * Returns 400 if the token is expired, already accepted, declined, or cancelled.
   */
  async acceptByToken(
    token: string,
    userId: string,
  ): Promise<{ message: string }> {
    const request = await this.clientRequestModel.findOne({
      where: { token },
    });

    if (!request) {
      throw new NotFoundException('Invitation not found');
    }

    if (request.status !== ClientRequestStatus.PENDING) {
      throw new BadRequestException(
        `This invitation has already been ${request.status.toLowerCase()}`,
      );
    }

    if (request.expiresAt < new Date()) {
      throw new BadRequestException('This invitation has expired');
    }

    const instructorId = request.fromUserId;
    const clientId = userId;

    await this.sequelize.transaction(async (transaction) => {
      // Bind the newly registered user to the email-only invitation
      await request.update(
        {
          toUserId: userId,
          status: ClientRequestStatus.ACCEPTED,
          respondedAt: new Date(),
        },
        { transaction },
      );

      // Create or activate the instructor_client relationship
      const existingRelationship = await this.instructorClientModel.findOne({
        where: { instructorId, clientId },
        transaction,
      });

      if (existingRelationship) {
        await existingRelationship.update(
          {
            status: InstructorClientStatus.ACTIVE,
            startedAt: new Date(),
          },
          { transaction },
        );
      } else {
        await this.instructorClientModel.create(
          {
            instructorId,
            clientId,
            status: InstructorClientStatus.ACTIVE,
            initiatedBy: InitiatedBy.INSTRUCTOR,
            startedAt: new Date(),
          },
          { transaction },
        );
      }
    });

    this.logger.log(
      `User ${userId} accepted invitation via token (instructor: ${instructorId})`,
      'ClientService',
    );

    return { message: 'Invitation accepted successfully.' };
  }

  // =====================================================
  // PRIVATE HELPERS
  // =====================================================

  /**
   * Find a client request by ID or throw NotFoundException
   */
  private async findRequestOrFail(requestId: string): Promise<ClientRequest> {
    const request = await this.clientRequestModel.findByPk(requestId);

    if (!request) {
      throw new NotFoundException('Client request not found');
    }

    return request;
  }

  /**
   * Assert no active instructor-client relationship exists between two users
   */
  private async assertNoActiveRelationship(
    instructorId: string,
    clientId: string,
  ): Promise<void> {
    const existing = await this.instructorClientModel.findOne({
      where: {
        instructorId,
        clientId,
        status: InstructorClientStatus.ACTIVE,
      },
    });

    if (existing) {
      throw new ConflictException(
        'An active instructor-client relationship already exists',
      );
    }
  }

  /**
   * Assert no pending request exists between an instructor and a potential client
   * (in either direction)
   */
  private async assertNoPendingRequest(
    instructorId: string,
    clientId: string,
  ): Promise<void> {
    const pendingRequest = await this.clientRequestModel.findOne({
      where: {
        status: ClientRequestStatus.PENDING,
        expiresAt: { [Op.gt]: new Date() },
        [Op.or]: [
          { fromUserId: instructorId, toUserId: clientId },
          { fromUserId: clientId, toUserId: instructorId },
        ],
      },
    });

    if (pendingRequest) {
      throw new ConflictException(
        'A pending request already exists between these users',
      );
    }
  }
}
