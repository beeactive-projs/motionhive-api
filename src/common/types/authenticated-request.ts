import type { Request as ExpressRequest } from 'express';
import type { User } from '../../modules/user/entities/user.entity';

/**
 * Shape of `req.user` as populated by the JWT strategy.
 *
 * The JWT strategy calls `user.get({ plain: true })` and appends the
 * user's role names, so `req.user` is effectively the full User entity
 * (without Sequelize methods) plus a flat list of role names for
 * authorization checks.
 *
 * Keep this in sync with `JwtStrategy.validate()` in
 * `src/modules/auth/strategies/jwt.strategy.ts`.
 */
export type AuthenticatedUser = Omit<
  User,
  | 'save'
  | 'reload'
  | 'update'
  | 'destroy'
  | 'restore'
  | 'get'
  | 'set'
  | 'toJSON'
  | 'changed'
  | 'previous'
  | 'increment'
  | 'decrement'
  | 'validate'
  | 'isNewRecord'
  | 'sequelize'
> & {
  roles: string[];
};

/**
 * Express Request with the authenticated user attached. Use this in
 * every controller method protected by `AuthGuard('jwt')`.
 */
export interface AuthenticatedRequest extends ExpressRequest {
  user: AuthenticatedUser;
}
