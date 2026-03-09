import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Inject,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize-typescript';
import { Op } from 'sequelize';
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
  ): Promise<PaginatedResponse<any>> {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const offset = (page - 1) * limit;

    // Build where clause
    const where: any = { instructorId };
    if (filters.status) {
      where.status = filters.status;
    } else {
      // Default to showing only ACTIVE clients
      where.status = InstructorClientStatus.ACTIVE;
    }

    const { rows, count: totalItems } =
      await this.instructorClientModel.findAndCountAll({
        where,
        include: [
          {
            model: User,
            as: 'client',
            attributes: ['id', 'firstName', 'lastName', 'email', 'avatarId'],
          },
        ],
        order: [['createdAt', 'DESC']],
        limit,
        offset,
        distinct: true,
      });

    // Fetch group memberships for these clients (only groups owned by this instructor)
    const clientIds = rows.map((r) => r.clientId);

    const groupMembershipsMap: Record<string, any[]> = {};

    if (clientIds.length > 0) {
      try {
        const groupMemberships = await GroupMember.findAll({
          where: {
            userId: { [Op.in]: clientIds },
          },
          include: [
            {
              model: Group,
              where: { createdBy: instructorId },
              attributes: ['id', 'name'],
            },
          ],
          attributes: ['userId'],
        });

        // Group memberships by client ID
        for (const membership of groupMemberships) {
          const userId = membership.getDataValue('userId');
          if (!groupMembershipsMap[userId]) {
            groupMembershipsMap[userId] = [];
          }
          groupMembershipsMap[userId].push({
            groupId: (membership as any).group?.id,
            groupName: (membership as any).group?.name,
          });
        }
      } catch {
        // Group module may not exist yet — gracefully degrade
        this.logger.warn(
          'Could not fetch group memberships — group module may not be available',
          'ClientService',
        );
      }
    }

    // Merge group memberships into client records
    const data = rows.map((row) => {
      const plain = row.toJSON();
      return {
        ...plain,
        groupMemberships: groupMembershipsMap[row.clientId] || [],
      };
    });

    return buildPaginatedResponse(data, totalItems, page, limit);
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
        attributes: [
          'userId',
          'displayName',
          'specializations',
          'bio',
          'locationCity',
          'locationCountry',
        ],
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

    const request = await this.clientRequestModel.create({
      fromUserId: instructorId,
      toUserId: null,
      invitedEmail: normalizedEmail,
      type: ClientRequestType.INSTRUCTOR_TO_CLIENT,
      message: message || null,
      status: ClientRequestStatus.PENDING,
      createdAt: new Date(),
      expiresAt,
    });

    // Send invitation email (fire-and-forget)
    const instructorName = instructor
      ? `${instructor.firstName} ${instructor.lastName}`
      : 'An instructor';

    this.emailService
      .sendClientInvitationEmail(normalizedEmail, instructorName, message)
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
      // Create instructor_client record with PENDING status
      await this.instructorClientModel.create(
        {
          instructorId,
          clientId: toUserId,
          status: InstructorClientStatus.PENDING,
          initiatedBy: InitiatedBy.INSTRUCTOR,
        },
        { transaction },
      );

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
      .sendClientInvitationEmail(targetUser.email, instructorName, message)
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
    updates: { notes?: string; status?: 'ACTIVE' | 'ARCHIVED' },
  ): Promise<InstructorClient> {
    const relationship = await this.instructorClientModel.findOne({
      where: { instructorId, clientId },
    });

    if (!relationship) {
      throw new NotFoundException('Client relationship not found');
    }

    const updateData: any = {};

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

    return relationship;
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
