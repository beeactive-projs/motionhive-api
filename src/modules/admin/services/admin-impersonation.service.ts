import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { Sequelize } from 'sequelize-typescript';
import { AuthService } from '../../auth/auth.service';
import { RoleService } from '../../role/role.service';
import { User } from '../../user/entities/user.entity';
import { AdminImpersonationLog } from '../entities/admin-impersonation-log.entity';
import { NON_IMPERSONABLE_ROLE_NAMES } from '../admin.constants';

/**
 * Mints short-lived impersonation tokens (SUPER_ADMIN only). The audit
 * row is written inside the same transaction that mints the token, so an
 * un-audited impersonation token can never be returned.
 */
@Injectable()
export class AdminImpersonationService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(AdminImpersonationLog)
    private readonly logModel: typeof AdminImpersonationLog,
    private readonly sequelize: Sequelize,
    private readonly authService: AuthService,
    private readonly roleService: RoleService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  async impersonate(
    adminId: string,
    targetUserId: string,
    reason: string,
    ip: string | null,
  ) {
    if (adminId === targetUserId) {
      throw new ForbiddenException('You cannot impersonate yourself.');
    }

    const target = await this.userModel.findByPk(targetUserId);
    if (!target) throw new NotFoundException('Target user not found');

    if (!target.isActive) {
      throw new ForbiddenException('Cannot impersonate a deactivated account.');
    }

    // Never impersonate staff (admins, support): privilege-escalation guard.
    const targetIsPrivileged = await this.roleService.userHasAnyRole(
      targetUserId,
      [...NON_IMPERSONABLE_ROLE_NAMES],
    );
    if (targetIsPrivileged) {
      throw new ForbiddenException('Cannot impersonate an admin account.');
    }

    const token = await this.sequelize.transaction(async (tx) => {
      await this.logModel.create(
        { adminUserId: adminId, targetUserId, reason, ip },
        { transaction: tx },
      );
      // Mint after the audit row is staged; commit guarantees both land.
      return this.authService.mintImpersonationToken(
        target.id,
        target.email,
        adminId,
      );
    });

    this.logger.log(
      `Admin ${adminId} impersonating user ${targetUserId} (reason: ${reason})`,
      'AdminImpersonationService',
    );

    return {
      accessToken: token.accessToken,
      expiresIn: token.expiresIn,
      targetUser: {
        id: target.id,
        email: target.email,
        firstName: target.firstName,
        lastName: target.lastName,
      },
    };
  }
}
