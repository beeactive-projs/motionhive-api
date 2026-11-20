import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { READ_ONLY_METHODS } from '../../common/guards/no-impersonation.guard';
import type { AuthenticatedUser } from '../../common/types/authenticated-request';
import { AdminAuditService } from './services/admin-audit.service';

/** The audit action every write made while impersonating is recorded under. */
export const IMPERSONATED_WRITE_ACTION = 'impersonation.write';

interface AuditedRequest {
  method: string;
  path: string;
  ip?: string;
  route?: { path?: string };
  user?: Pick<AuthenticatedUser, 'id' | 'impersonatedBy'>;
}

/**
 * Records every write made with an admin impersonation token in
 * admin_action_log: the admin, the person acted as, the route (its
 * pattern, never the query string) and whether it worked. The token's own
 * creation is in admin_impersonation_log; this is what was done with it.
 * Reads are not recorded, and normal tokens pass untouched. Writes that
 * NoImpersonationGuard refuses never reach here (guards run first) and
 * are logged by the guard instead.
 *
 * Registered app-wide from AdminModule (APP_INTERCEPTOR). The row is
 * written after the answer, without waiting: AdminAuditService.record
 * never throws, so a failed audit write cannot fail the request.
 */
@Injectable()
export class ImpersonationAuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AdminAuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }
    const req = context.switchToHttp().getRequest<AuditedRequest>();
    const user = req.user;
    if (!user || !user.impersonatedBy) {
      return next.handle();
    }
    if (READ_ONLY_METHODS.has(req.method)) {
      return next.handle();
    }

    const adminUserId = user.impersonatedBy;
    let route = req.path;
    if (req.route && req.route.path) {
      route = req.route.path;
    }
    const handler = `${context.getClass().name}.${context.getHandler().name}`;

    const record = (outcome: { ok: boolean; status?: number }) => {
      void this.audit.record({
        adminUserId,
        action: IMPERSONATED_WRITE_ACTION,
        targetType: 'user',
        targetId: user.id,
        meta: { method: req.method, route, handler, ...outcome },
        ip: req.ip ?? null,
      });
    };

    return next.handle().pipe(
      tap({
        next: () => record({ ok: true }),
        error: (err: unknown) => {
          let status = 500;
          if (err instanceof HttpException) {
            status = err.getStatus();
          }
          record({ ok: false, status });
        },
      }),
    );
  }
}
