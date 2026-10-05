import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../../user/user.service';
import { RoleService } from '../../role/role.service';
import { apiError } from '../../../common/i18n';
import { TokenTypes, type JwtPayload } from '../types/jwt-payload';

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
    // A stream ticket is signed with the same secret, so the signature
    // check above passes. It is scoped to `GET /messaging/stream` and must
    // not reach anything else — without this, the short-lived ticket would
    // be a full access token wearing a shorter expiry.
    if (payload.typ === TokenTypes.STREAM_TICKET) {
      throw new UnauthorizedException(apiError('common.unauthorized'));
    }

    const user = await this.userService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException(apiError('common.unauthorized'));
    }

    if (!user.isActive) {
      throw new UnauthorizedException(apiError('auth.accountDeactivated'));
    }

    // Reject tokens issued before the user changed their password.
    if (user.passwordChangedAt && payload.iat) {
      const passwordChangedAtSec = Math.floor(
        user.passwordChangedAt.getTime() / 1000,
      );
      if (payload.iat < passwordChangedAtSec) {
        throw new UnauthorizedException(apiError('auth.passwordChanged'));
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
