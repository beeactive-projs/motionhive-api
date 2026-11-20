import type { Logger } from '@nestjs/common';
import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { createHash, timingSafeEqual } from 'crypto';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { QueueName } from './job-registry';

const BULL_BOARD_PATH = '/admin/queues';

/** Wrong credentials one address may send before it has to wait. */
export const BULL_BOARD_MAX_FAILURES = 10;
/** How long those wrong tries are remembered. */
export const BULL_BOARD_FAILURE_WINDOW_MS = 15 * 60_000;
/** Addresses remembered at once; past it the oldest are forgotten first. */
const MAX_TRACKED_ADDRESSES = 10_000;

type Gate = (req: Request, res: Response, next: NextFunction) => void;

interface Failures {
  count: number;
  resetAt: number;
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** The user and password of a `Basic` header, or null when there is none. */
function readBasicCredentials(
  header: string | undefined,
): { user: string; password: string } | null {
  if (!header || !header.startsWith('Basic ')) {
    return null;
  }
  const decoded = Buffer.from(header.slice(6), 'base64').toString('utf-8');
  const idx = decoded.indexOf(':');
  if (idx < 0) {
    return { user: decoded, password: '' };
  }
  return { user: decoded.slice(0, idx), password: decoded.slice(idx + 1) };
}

/**
 * HTTP basic auth for Bull Board. It runs as Express middleware, outside
 * the Nest throttler, so it counts wrong tries itself: after
 * BULL_BOARD_MAX_FAILURES from one address in the window, that address
 * gets 429 until the window ends, the right password included. A request
 * with no credentials (the browser's first, which brings up its prompt)
 * is not a try. Both values are compared as SHA-256 digests with
 * timingSafeEqual, so the time taken says nothing about how close a guess
 * was, and both are always compared.
 */
export function createBasicAuthGate(
  user: string,
  password: string,
  now: () => number = Date.now,
): Gate {
  const expectedUser = sha256(user);
  const expectedPassword = sha256(password);
  const failures = new Map<string, Failures>();

  const forgetExpired = (at: number): void => {
    for (const [address, entry] of failures) {
      if (entry.resetAt <= at) {
        failures.delete(address);
      }
    }
    while (failures.size >= MAX_TRACKED_ADDRESSES) {
      const oldest = failures.keys().next();
      if (oldest.done) {
        break;
      }
      failures.delete(oldest.value);
    }
  };

  return (req, res, next) => {
    const address = req.ip ?? 'unknown';
    const at = now();

    let entry = failures.get(address);
    if (entry && entry.resetAt <= at) {
      failures.delete(address);
      entry = undefined;
    }
    if (entry && entry.count >= BULL_BOARD_MAX_FAILURES) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - at) / 1000)));
      res.status(429).send('Too many attempts, try again later');
      return;
    }

    const given = readBasicCredentials(req.headers.authorization);
    if (!given) {
      res.set('WWW-Authenticate', 'Basic realm="bull-board"');
      res.status(401).send('Authentication required');
      return;
    }

    const userMatches = timingSafeEqual(sha256(given.user), expectedUser);
    const passwordMatches = timingSafeEqual(
      sha256(given.password),
      expectedPassword,
    );
    if (userMatches && passwordMatches) {
      failures.delete(address);
      next();
      return;
    }

    if (entry) {
      entry.count += 1;
    } else {
      if (failures.size >= MAX_TRACKED_ADDRESSES) {
        forgetExpired(at);
      }
      failures.set(address, {
        count: 1,
        resetAt: at + BULL_BOARD_FAILURE_WINDOW_MS,
      });
    }
    res.set('WWW-Authenticate', 'Basic realm="bull-board"');
    res.status(401).send('Invalid credentials');
  };
}

/**
 * Mount the Bull Board admin UI at /admin/queues, gated by HTTP
 * basic auth. This is intentionally a separate auth path from the
 * rest of the API:
 *
 *   - Bull Board ships an Express handler, not Nest routes — it
 *     sits below NestJS's pipe/guard layer
 *   - Wiring JWT into Express middleware would require duplicating
 *     the JWT-strategy logic outside Nest's DI, which is ugly
 *   - HTTP basic auth is a 5-line middleware. We set credentials
 *     via env (BULL_BOARD_USER / BULL_BOARD_PASSWORD) and rotate
 *     them by changing env vars — no code changes
 *
 * If either credential env var is missing the route never mounts
 * (404). That's the right "default off" posture for an admin panel.
 *
 * Idempotent: safe to call multiple times during boot (only takes
 * effect once because the setup checks for the credentials).
 */
export function setupBullBoard(app: INestApplication, logger: Logger): void {
  const user = process.env.BULL_BOARD_USER;
  const password = process.env.BULL_BOARD_PASSWORD;

  if (!user || !password) {
    logger.warn(
      `Bull Board not mounted — set BULL_BOARD_USER + BULL_BOARD_PASSWORD to enable ${BULL_BOARD_PATH}`,
    );
    return;
  }

  // Resolve every registered queue from the Nest DI container. We
  // can't statically import Queue refs because BullModule provides
  // them lazily via tokens.
  const queues: Queue[] = [];
  for (const name of Object.values(QueueName)) {
    try {
      const queue = app.get<Queue>(getQueueToken(name), { strict: false });
      if (queue) queues.push(queue);
    } catch {
      // Queue not registered (e.g. REDIS_HOST not set) → skip.
    }
  }

  if (queues.length === 0) {
    logger.warn(
      'Bull Board not mounted — no BullMQ queues are registered (is Redis configured?)',
    );
    return;
  }

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(BULL_BOARD_PATH);
  createBullBoard({
    queues: queues.map((q) => new BullMQAdapter(q)),
    serverAdapter,
  });

  const basicAuth = createBasicAuthGate(user, password);
  app.use(BULL_BOARD_PATH, basicAuth, serverAdapter.getRouter());
  logger.log(`Bull Board mounted at ${BULL_BOARD_PATH} (basic auth)`);
}
