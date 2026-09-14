import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../../user/user.service';
import { RoleService } from '../../role/role.service';
import type { JwtPayload } from '../types/jwt-payload';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private readonly configService: ConfigService,
    private readonly userService: UserService,
    private readonly roleService: RoleService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');
    // Fail fast — env validation should already have caught this.
    if (!secret) {
      throw new Error('JWT_SECRET is not configured.');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Runs after signature verification. Returns the user object that
   * gets attached to `req.user`. Throws UnauthorizedException for any
   * reason the token shouldn't be honored anymore.
   */
  async validate(payload: JwtPayload) {
    const user = await this.userService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('User not found or has been deleted');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('User account is deactivated');
    }

    // Reject tokens issued before the user changed their password.
    if (user.passwordChangedAt && payload.iat) {
      const passwordChangedAtSec = Math.floor(
        user.passwordChangedAt.getTime() / 1000,
      );
      if (payload.iat < passwordChangedAtSec) {
        throw new UnauthorizedException(
          'Password was changed. Please log in again.',
        );
      }
    }

    // Global role names (not group-scoped), served from RoleService's
    // short-lived cache so the second database round trip of every
    // request only happens about once a minute per user.
    const roleNames = await this.roleService.getUserRoleNames(user.id);

    return {
      ...user.get({ plain: true }),
      roles: roleNames,
      // Present only on admin impersonation tokens. Additive: normal
      // tokens have no `act_as`, so `impersonatedBy` is simply absent.
      ...(payload.act_as ? { impersonatedBy: payload.act_as } : {}),
    };
  }
}
