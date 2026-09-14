import { Inject, Injectable, NestMiddleware } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';

/**
 * Request Timing Middleware
 *
 * Measures every request from the moment it enters the middleware
 * chain (before guards, pipes and the handler) until the response has
 * finished, and:
 *
 *   1. Logs one structured line per request — `method`, `route` (the
 *      Express pattern, e.g. `/messaging/conversations/:id`), `status`,
 *      `durationMs`, `requestId`, `userId`. In production the Winston
 *      JSON format turns these into searchable fields, so "which routes
 *      take over 500 ms" is a single log query on Railway.
 *   2. Adds a `Server-Timing: app;dur=<ms>` header so the browser's
 *      Network → Timing tab shows server time inline, next to the
 *      network cost. That split (server vs distance) is the first
 *      question whenever something feels slow.
 *
 * `/health` is exempt from the log line (Railway polls it every few
 * seconds) but still gets the header.
 *
 * Registered in AppModule after RequestIdMiddleware so `requestId` is
 * already on the request.
 */
@Injectable()
export class RequestTimingMiddleware implements NestMiddleware {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();
    const elapsedMs = (): number =>
      Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    // Headers are flushed by writeHead — called explicitly, or
    // implicitly by res.end(). Wrapping it is the last point where a
    // header can still be added.
    const patchable = res as unknown as {
      writeHead: (...args: unknown[]) => Response;
    };
    const originalWriteHead = patchable.writeHead.bind(res);
    patchable.writeHead = (...args: unknown[]): Response => {
      if (!res.headersSent) {
        res.setHeader('Server-Timing', `app;dur=${elapsedMs().toFixed(1)}`);
      }
      return originalWriteHead(...args);
    };

    res.on('finish', () => {
      if (req.path === '/health') return;

      const durationMs = Math.round(elapsedMs() * 10) / 10;
      const path = req.originalUrl.split('?')[0];
      const pattern = routePattern(req);
      const route = pattern ? `${req.baseUrl}${pattern}` : path;
      const user = (req as Request & { user?: { id?: unknown } }).user;
      const userId = typeof user?.id === 'string' ? user.id : null;

      this.logger.log(
        {
          message: `${req.method} ${path} ${res.statusCode} ${durationMs}ms`,
          method: req.method,
          route,
          path,
          status: res.statusCode,
          durationMs,
          requestId: req.requestId ?? null,
          userId,
        },
        'Http',
      );
    });

    next();
  }
}

/**
 * The Express route pattern the request matched (`/groups/:id`), or
 * null when it matched nothing (404s, unrouted OPTIONS).
 */
function routePattern(req: Request): string | null {
  const route: unknown = req.route;
  if (route && typeof route === 'object' && 'path' in route) {
    const path = (route as { path: unknown }).path;
    if (typeof path === 'string') return path;
  }
  return null;
}
