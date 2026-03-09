import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UserService } from '../../user/user.service';
import { RoleService } from '../../role/role.service';

/**
 * JWT Strategy
 *
 * This is a Passport.js strategy that validates JWT tokens.
 * Passport is a popular authentication library for Node.js.
 *
 * How it works:
 * 1. Extract JWT from "Authorization: Bearer <token>" header
 * 2. Verify signature using JWT_SECRET
 * 3. If valid, call validate() with decoded payload
 * 4. validate() checks if user still exists in DB
 * 5. User object is attached to request (req.user)
 *
 * Used with @UseGuards(AuthGuard('jwt')) on protected routes
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    private userService: UserService,
    private roleService: RoleService,
  ) {
    const secret = configService.get<string>('JWT_SECRET');

    // ✅ SECURITY FIX: No fallback secret!
    // Fail fast if secret is missing (should be caught by env validation)
    if (!secret) {
      throw new Error(
        'JWT_SECRET is not configured! This is a critical security issue.',
      );
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false, // Reject expired tokens
      secretOrKey: secret,
    });
  }

  /**
   * Validate JWT Payload
   *
   * Called after JWT signature is verified.
   * Check if user still exists and is active.
   * Load user's roles for authorization.
   *
   * @param payload - Decoded JWT payload { sub: userId, email: ... }
   * @returns User object with roles (attached to req.user)
   * @throws UnauthorizedException if user not found
   */
  async validate(payload: any) {
    const user = await this.userService.findById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('User not found or has been deleted');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('User account is deactivated');
    }

    // Reject tokens issued before password was changed
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

    // Load user's global roles (not org-specific)
    const roles = await this.roleService.getUserRoles(user?.id);
    const roleNames = roles.map((role) => role.name);

    return {
      ...user.get({ plain: true }),
      roles: roleNames,
    };
  }
}
