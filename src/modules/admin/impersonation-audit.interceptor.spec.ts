import {
  CallHandler,
  ExecutionContext,
  NotFoundException,
} from '@nestjs/common';
import { lastValueFrom, of, throwError } from 'rxjs';
import {
  IMPERSONATED_WRITE_ACTION,
  ImpersonationAuditInterceptor,
} from './impersonation-audit.interceptor';
import type { AdminAuditService } from './services/admin-audit.service';

class WorkoutLogController {}

/** The route handler; the interceptor only reads its name. */
function complete(): void {}

interface FakeRequest {
  method: string;
  path: string;
  ip?: string;
  route?: { path?: string };
  user?: { id: string; impersonatedBy?: string };
}

function contextFor(req: FakeRequest, type = 'http'): ExecutionContext {
  return {
    getType: () => type,
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => complete,
    getClass: () => WorkoutLogController,
  } as unknown as ExecutionContext;
}

function answering(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

describe('ImpersonationAuditInterceptor', () => {
  const record = jest.fn<Promise<void>, [unknown]>();
  const interceptor = new ImpersonationAuditInterceptor({
    record,
  } as unknown as AdminAuditService);

  const support = { id: 'user-1', impersonatedBy: 'admin-1' };
  const write: FakeRequest = {
    method: 'POST',
    path: '/workout-logs/0f1e/complete',
    ip: '203.0.113.7',
    route: { path: '/workout-logs/:id/complete' },
    user: support,
  };

  beforeEach(() => {
    record.mockReset();
    record.mockResolvedValue(undefined);
  });

  it('records a write made while acting as someone, under the admin', async () => {
    await expect(
      lastValueFrom(
        interceptor.intercept(contextFor(write), answering('done')),
      ),
    ).resolves.toBe('done');

    expect(record).toHaveBeenCalledWith({
      adminUserId: 'admin-1',
      action: IMPERSONATED_WRITE_ACTION,
      targetType: 'user',
      targetId: 'user-1',
      meta: {
        method: 'POST',
        route: '/workout-logs/:id/complete',
        handler: 'WorkoutLogController.complete',
        ok: true,
      },
      ip: '203.0.113.7',
    });
  });

  it('records a write that failed, with its status, and still fails it', async () => {
    const failing: CallHandler = {
      handle: () => throwError(() => new NotFoundException()),
    };
    await expect(
      lastValueFrom(interceptor.intercept(contextFor(write), failing)),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ ok: false, status: 404 }) as unknown,
      }),
    );
  });

  it('keeps the route pattern, never the query string', async () => {
    await lastValueFrom(
      interceptor.intercept(
        contextFor({ ...write, route: undefined, path: '/things/1' }),
        answering(null),
      ),
    );
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({ route: '/things/1' }) as unknown,
      }),
    );
  });

  it('does not record reads', async () => {
    await lastValueFrom(
      interceptor.intercept(
        contextFor({ ...write, method: 'GET' }),
        answering([]),
      ),
    );
    expect(record).not.toHaveBeenCalled();
  });

  it('does not record the person’s own writes', async () => {
    await lastValueFrom(
      interceptor.intercept(
        contextFor({ ...write, user: { id: 'user-1' } }),
        answering(null),
      ),
    );
    await lastValueFrom(
      interceptor.intercept(
        contextFor({ ...write, user: undefined }),
        answering(null),
      ),
    );
    expect(record).not.toHaveBeenCalled();
  });

  it('leaves anything that is not HTTP alone', async () => {
    await lastValueFrom(
      interceptor.intercept(contextFor(write, 'rpc'), answering(null)),
    );
    expect(record).not.toHaveBeenCalled();
  });
});
