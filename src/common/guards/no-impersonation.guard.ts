import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { apiError } from '../i18n';
import type { AuthenticatedUser } from '../types/authenticated-request';

export const ALLOW_WHILE_IMPERSONATING_KEY = 'allowWhileImpersonating';

/**
 * Lets one write through NoImpersonationGuard: for a write that changes
 * nothing of the person's (e.g. pulling their Stripe status into our copy).
 */
export const AllowWhileImpersonating = () =>
  SetMetadata(ALLOW_WHILE_IMPERSONATING_KEY, true);

/** Methods that only read; support may always do these while acting as someone. */
export const READ_ONLY_METHODS: ReadonlySet<string> = new Set([
  'GET',
  'HEAD',
  'OPTIONS',
]);

interface GuardedRequest {
  method: string;
  user?: Pick<AuthenticatedUser, 'id' | 'impersonatedBy'>;
}

/**
 * Refuses writes made with an admin impersonation token (`act_as`, read
 * into `req.user.impersonatedBy` by JwtStrategy). Support sees what the
 * person sees, but money, credentials and devices stay the person's own:
 * no refund, invoice or Stripe dashboard link in their name, no password
 * change, no phone registered to receive their notifications after the
 * session ends. Reads pass.
 *
 * Goes after `AuthGuard('jwt')` in the same `@UseGuards`, so `req.user`
 * is set. Normal tokens carry no `act_as` and always pass.
 */
@Injectable()
export class NoImpersonationGuard implements CanActivate {
  private readonly logger = new Logger(NoImpersonationGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<GuardedRequest>();
    const user = req.user;
    if (!user || !user.impersonatedBy) {
      return true;
    }
    if (READ_ONLY_METHODS.has(req.method)) {
      return true;
    }
    const allowed = this.reflector.getAllAndOverride<boolean | undefined>(
      ALLOW_WHILE_IMPERSONATING_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (allowed) {
      return true;
    }

    this.logger.warn(
      `Refused ${req.method} ${context.getClass().name}.${context.getHandler().name} ` +
        `by admin ${user.impersonatedBy} acting as user ${user.id}`,
    );
    throw new ForbiddenException(apiError('common.notWhileImpersonating'));
  }
}
