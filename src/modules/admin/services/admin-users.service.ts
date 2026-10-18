import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Op, type WhereOptions } from 'sequelize';
import {
  buildPaginatedResponse,
  getOffset,
} from '../../../common/dto/pagination.dto';
import { Role } from '../../role/entities/role.entity';
import { UserRole } from '../../role/entities/user-role.entity';
import { RoleService } from '../../role/role.service';
import { AuthService } from '../../auth/auth.service';
import { AccountDeletionService } from '../../account-deletion/account-deletion.service';
import { User } from '../../user/entities/user.entity';
import { InstructorProfile } from '../../profile/entities/instructor-profile.entity';
import { Group } from '../../group/entities/group.entity';
import { SessionInstance } from '../../session/entities/session-instance.entity';
import { InstructorClient } from '../../client/entities/instructor-client.entity';
import { StripeAccount } from '../../payment/entities/stripe-account.entity';
import { RefreshToken } from '../../auth/entities/refresh-token.entity';
import { WorkoutLog } from '../../workout/entities/workout-log.entity';
import { SessionParticipant } from '../../session/entities/session-participant.entity';
import { Message } from '../../messaging/entities/message.entity';
import { ProgramAssignment } from '../../workout/entities/program-assignment.entity';
import { Program } from '../../workout/entities/program.entity';
import { Post } from '../../post/entities/post.entity';
import { ListUsersDto } from '../dto/list-users.dto';
import { UpdateUserStatusDto } from '../dto/update-user-status.dto';
import { PRIVILEGED_ROLE_NAMES } from '../admin.constants';
import { AdminAuditService } from './admin-audit.service';

/**
 * Admin-safe user columns. Like USER_SAFE_ATTRIBUTES but adds the
 * moderation fields an operator needs (lockout, verification, lastLogin,
 * deletedAt). Still excludes passwordHash and all token columns.
 */
const ADMIN_USER_LIST_ATTRIBUTES: Array<keyof User> = [
  'id',
  'email',
  'firstName',
  'lastName',
  'handle',
  'phone',
  'avatarUrl',
  'countryCode',
  'city',
  'isActive',
  'isEmailVerified',
  'failedLoginAttempts',
  'lockedUntil',
  'lastLoginAt',
  'createdAt',
  'updatedAt',
  'deletedAt',
];

/**
 * Cross-tenant user management for the admin app. Unlike the owner-scoped
 * user/profile services, every method here operates on ANY user by id —
 * authorization is enforced at the controller (ADMIN/SUPER_ADMIN gate).
 */
@Injectable()
export class AdminUsersService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(UserRole) private readonly userRoleModel: typeof UserRole,
    @InjectModel(Role) private readonly roleModel: typeof Role,
    @InjectModel(InstructorProfile)
    private readonly instructorProfileModel: typeof InstructorProfile,
    @InjectModel(Group) private readonly groupModel: typeof Group,
    @InjectModel(SessionInstance)
    private readonly sessionInstanceModel: typeof SessionInstance,
    @InjectModel(InstructorClient)
    private readonly instructorClientModel: typeof InstructorClient,
    @InjectModel(StripeAccount)
    private readonly stripeAccountModel: typeof StripeAccount,
    @InjectModel(RefreshToken)
    private readonly refreshTokenModel: typeof RefreshToken,
    @InjectModel(WorkoutLog)
    private readonly workoutLogModel: typeof WorkoutLog,
    @InjectModel(SessionParticipant)
    private readonly sessionParticipantModel: typeof SessionParticipant,
    @InjectModel(Message) private readonly messageModel: typeof Message,
    @InjectModel(ProgramAssignment)
    private readonly programAssignmentModel: typeof ProgramAssignment,
    @InjectModel(Program) private readonly programModel: typeof Program,
    @InjectModel(Post) private readonly postModel: typeof Post,
    private readonly roleService: RoleService,
    private readonly authService: AuthService,
    private readonly accountDeletionService: AccountDeletionService,
    private readonly audit: AdminAuditService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async listUsers(dto: ListUsersDto) {
    const page = dto.page ?? 1;
    const limit = dto.limit ?? 20;

    const and: WhereOptions<User>[] = [];

    if (dto.q?.trim()) {
      const term = `%${dto.q.trim()}%`;
      and.push({
        [Op.or]: [
          { firstName: { [Op.iLike]: term } },
          { lastName: { [Op.iLike]: term } },
          { email: { [Op.iLike]: term } },
          { handle: { [Op.iLike]: term } },
        ],
      } as WhereOptions<User>);
    }

    if (dto.isActive !== undefined) and.push({ isActive: dto.isActive });
    if (dto.isEmailVerified !== undefined) {
      and.push({ isEmailVerified: dto.isEmailVerified });
    }
    if (dto.locked) {
      and.push({ lockedUntil: { [Op.gt]: new Date() } } as WhereOptions<User>);
    }

    // Role filter → resolve role id → user ids (avoids a join on the
    // paranoid model).
    if (dto.role) {
      const role = await this.roleModel.findOne({ where: { name: dto.role } });
      const links = role
        ? await this.userRoleModel.findAll({
            where: { roleId: role.id },
            attributes: ['userId'],
          })
        : [];
      const ids = links.map((l) => l.userId);
      // No users in role → force empty result.
      and.push({
        id: ids.length ? { [Op.in]: ids } : null,
      } as WhereOptions<User>);
    }

    // Paranoid handling.
    let paranoid = true;
    if (dto.onlyDeleted) {
      paranoid = false;
      and.push({ deletedAt: { [Op.ne]: null } } as WhereOptions<User>);
    } else if (dto.includeDeleted) {
      paranoid = false;
    }

    const where: WhereOptions<User> = and.length ? { [Op.and]: and } : {};

    const { rows, count } = await this.userModel.findAndCountAll({
      where,
      paranoid,
      attributes: ADMIN_USER_LIST_ATTRIBUTES,
      include: [{ model: Role, through: { attributes: [] } }],
      distinct: true,
      limit,
      offset: getOffset(page, limit),
      order: [['createdAt', 'DESC']],
    });

    const items = rows.map((u) => this.toListItem(u));
    return buildPaginatedResponse(items, count, page, limit);
  }

  async getUserDetail(id: string) {
    const user = await this.userModel.findByPk(id, {
      paranoid: false,
      attributes: ADMIN_USER_LIST_ATTRIBUTES,
      include: [{ model: Role, through: { attributes: [] } }],
    });
    if (!user) throw new NotFoundException('User not found');

    const [
      groupCount,
      sessionCount,
      clientCount,
      instructorProfile,
      stripeAccount,
      latestRefresh,
      deletion,
    ] = await Promise.all([
      this.groupModel.count({ where: { instructorId: id } }),
      this.sessionInstanceModel.count({ where: { instructorId: id } }),
      this.instructorClientModel.count({ where: { instructorId: id } }),
      this.instructorProfileModel.findOne({ where: { userId: id } }),
      this.stripeAccountModel.findOne({ where: { userId: id } }),
      // NOTE: refresh_token has no created_at column (entity is
      // timestamps:false). Order by expiresAt — newest token = latest
      // expiry since expiry = issue + fixed window.
      this.refreshTokenModel.findOne({
        where: { userId: id },
        order: [['expiresAt', 'DESC']],
      }),
      this.accountDeletionService.latestFor(id),
    ]);

    return {
      ...this.toListItem(user),
      roles: (user.roles ?? []).map((r) => r.name),
      counts: {
        groups: groupCount,
        sessions: sessionCount,
        clients: clientCount,
      },
      instructorProfile: instructorProfile
        ? {
            id: instructorProfile.id,
            displayName: instructorProfile.displayName,
            isPublic: instructorProfile.isPublic,
            isAcceptingClients: instructorProfile.isAcceptingClients,
          }
        : null,
      // Onboarding state only — never any Stripe secret.
      stripeAccount: stripeAccount
        ? {
            stripeAccountId: stripeAccount.stripeAccountId,
            chargesEnabled: stripeAccount.chargesEnabled,
            payoutsEnabled: stripeAccount.payoutsEnabled,
            detailsSubmitted: stripeAccount.detailsSubmitted,
            country: stripeAccount.country,
            defaultCurrency: stripeAccount.defaultCurrency,
            disabledReason: stripeAccount.disabledReason,
          }
        : null,
      // Token metadata only — never the hash. (refresh_token has no
      // created_at column, so expiresAt is the only timestamp available.)
      lastSession: latestRefresh
        ? {
            expiresAt: latestRefresh.expiresAt,
            revoked: !!latestRefresh.revokedAt,
            deviceInfo: latestRefresh.deviceInfo,
            ipAddress: latestRefresh.ipAddress,
          }
        : null,
      // A deletion under way or done, so nobody acts on a request twice.
      deletion: deletion
        ? {
            status: deletion.status,
            requestedAt: deletion.requestedAt,
            scheduledFor: deletion.scheduledFor,
            erasedAt: deletion.erasedAt,
          }
        : null,
    };
  }

  /**
   * GDPR-safe engagement snapshot for one user: COUNTS + metadata only,
   * never message/post content. Reading actual messages stays on the
   * audited messaging-moderation path. Cheap parallel counts by FK.
   */
  async getUserActivity(id: string) {
    const user = await this.userModel.findByPk(id, {
      paranoid: false,
      attributes: ['id', 'lastLoginAt'],
    });
    if (!user) throw new NotFoundException('User not found');

    const [
      workoutsLogged,
      bookings,
      posts,
      messagesSent,
      programsAssigned,
      routines,
      sessionsTotal,
      sessionsActive,
    ] = await Promise.all([
      this.workoutLogModel.count({ where: { userId: id } }),
      this.sessionParticipantModel.count({ where: { userId: id } }),
      this.postModel.count({ where: { authorId: id } }),
      this.messageModel.count({ where: { senderId: id } }),
      this.programAssignmentModel.count({ where: { clientId: id } }),
      // Post-056 a routine is a single-workout program this user owns.
      this.programModel.count({
        where: { ownerId: id, isSingleWorkout: true },
      }),
      this.refreshTokenModel.count({ where: { userId: id } }),
      this.refreshTokenModel.count({
        where: {
          userId: id,
          revokedAt: null,
          expiresAt: { [Op.gt]: new Date() },
        },
      }),
    ]);

    return {
      lastLoginAt: user.lastLoginAt ?? null,
      counts: {
        workoutsLogged,
        bookings,
        posts,
        messagesSent,
        programsAssigned,
        routines,
      },
      // login-event tracking doesn't exist yet — refresh tokens are the
      // best available proxy for "active sessions / devices".
      sessions: { total: sessionsTotal, active: sessionsActive },
    };
  }

  async updateStatus(
    adminId: string,
    id: string,
    dto: UpdateUserStatusDto,
    ip: string | null = null,
  ) {
    const user = await this.userModel.findByPk(id, { paranoid: false });
    if (!user) throw new NotFoundException('User not found');

    if (dto.isActive !== undefined) user.isActive = dto.isActive;
    if (dto.unlock) {
      user.lockedUntil = null;
      user.failedLoginAttempts = 0;
    }
    if (dto.forceEmailVerified) {
      user.isEmailVerified = true;
      user.emailVerificationToken = null;
      user.emailVerificationExpires = null;
    }

    await user.save();
    await this.audit.record({
      adminUserId: adminId,
      action: 'user.status.update',
      targetType: 'user',
      targetId: id,
      meta: { ...dto },
      ip,
    });
    this.logger.log(
      `Admin ${adminId} updated status of user ${id}: ${JSON.stringify(dto)}`,
      'AdminUsersService',
    );
    return this.getUserDetail(id);
  }

  async assignRole(adminId: string, id: string, role: string) {
    const user = await this.userModel.findByPk(id, { paranoid: false });
    if (!user) throw new NotFoundException('User not found');

    await this.roleService.assignRoleToUserByName(id, role);
    await this.audit.record({
      adminUserId: adminId,
      action: 'user.role.assign',
      targetType: 'user',
      targetId: id,
      meta: { role },
    });
    this.logger.log(
      `Admin ${adminId} assigned role ${role} to user ${id}`,
      'AdminUsersService',
    );
    return {
      roles: (await this.roleService.getUserRoles(id)).map((r) => r.name),
    };
  }

  async revokeRole(adminId: string, id: string, role: string) {
    // Self-lockout guard: an admin can't strip their own privileged role.
    if (adminId === id && PRIVILEGED_ROLE_NAMES.includes(role)) {
      throw new BadRequestException('You cannot revoke your own admin role.');
    }

    const roleRow = await this.roleModel.findOne({ where: { name: role } });
    if (!roleRow) throw new NotFoundException(`Role ${role} not found`);

    const remaining = await this.roleService.getUserRoles(id);
    if (remaining.length <= 1 && remaining.some((r) => r.name === role)) {
      throw new BadRequestException(
        "Cannot revoke a user's only remaining role.",
      );
    }

    await this.roleService.removeRoleFromUser(id, roleRow.id);
    await this.audit.record({
      adminUserId: adminId,
      action: 'user.role.revoke',
      targetType: 'user',
      targetId: id,
      meta: { role },
    });
    this.logger.log(
      `Admin ${adminId} revoked role ${role} from user ${id}`,
      'AdminUsersService',
    );
    return {
      roles: (await this.roleService.getUserRoles(id)).map((r) => r.name),
    };
  }

  async resendVerification(
    adminId: string,
    id: string,
    ip: string | null = null,
  ) {
    const user = await this.userModel.findByPk(id);
    if (!user) throw new NotFoundException('User not found');
    if (user.isEmailVerified) {
      throw new BadRequestException('User email is already verified.');
    }
    // Reuse the existing (token-gen + Resend) path.
    await this.authService.resendVerification({ email: user.email });
    await this.audit.record({
      adminUserId: adminId,
      action: 'user.resend_verification',
      targetType: 'user',
      targetId: id,
      ip,
    });
    this.logger.log(
      `Admin ${adminId} resent verification email to user ${id}`,
      'AdminUsersService',
    );
    return { sent: true };
  }

  /**
   * Act on a deletion request someone emailed us: the same deactivate,
   * wind-down and 30-day erasure as deleting in the app. The audit row
   * keeps no email, so nothing personal outlives the erasure here.
   */
  async scheduleDeletion(
    adminId: string,
    id: string,
    requestEmail: string,
    ip: string | null = null,
  ) {
    const { scheduledFor } =
      await this.accountDeletionService.scheduleOnRequest(id, requestEmail);
    await this.audit.record({
      adminUserId: adminId,
      action: 'user.deletion.schedule',
      targetType: 'user',
      targetId: id,
      meta: { scheduledFor },
      ip,
    });
    this.logger.log(
      `Admin ${adminId} scheduled deletion of user ${id} for ${scheduledFor}`,
      'AdminUsersService',
    );
    return this.getUserDetail(id);
  }

  async restoreUser(adminId: string, id: string) {
    const user = await this.userModel.findByPk(id, { paranoid: false });
    if (!user) throw new NotFoundException('User not found');
    if (!user.deletedAt) {
      throw new BadRequestException('User is not deleted.');
    }

    await user.restore();
    await this.audit.record({
      adminUserId: adminId,
      action: 'user.restore',
      targetType: 'user',
      targetId: id,
    });
    this.logger.log(
      `Admin ${adminId} restored soft-deleted user ${id}`,
      'AdminUsersService',
    );
    return this.getUserDetail(id);
  }

  private toListItem(u: User) {
    return {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      handle: u.handle,
      phone: u.phone,
      avatarUrl: u.avatarUrl,
      countryCode: u.countryCode,
      city: u.city,
      isActive: u.isActive,
      isEmailVerified: u.isEmailVerified,
      failedLoginAttempts: u.failedLoginAttempts,
      lockedUntil: u.lockedUntil,
      locked: !!u.lockedUntil && u.lockedUntil.getTime() > Date.now(),
      lastLoginAt: u.lastLoginAt ?? null,
      createdAt: u.createdAt,
      deletedAt: u.deletedAt ?? null,
      roles: (u.roles ?? []).map((r) => r.name),
    };
  }
}
