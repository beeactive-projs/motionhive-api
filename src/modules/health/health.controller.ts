import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  SequelizeHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthService } from './health.service';

/**
 * Health Check Controller
 *
 * Provides endpoints for monitoring the application's health.
 * Used by:
 * - Load balancers (Railway, AWS, etc.) to know if the instance is healthy
 * - Monitoring tools (DataDog, New Relic, etc.)
 * - DevOps team for troubleshooting
 *
 * If health check fails, Railway will restart the container automatically!
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: SequelizeHealthIndicator,
    private readonly healthService: HealthService,
  ) {}

  /**
   * Liveness probe (what Railway hits, frequently).
   *
   * IMPORTANT: this must NOT touch the database. Railway polls this
   * endpoint every ~15-30s; if it ran a `SELECT 1` each time, the
   * Postgres compute (Neon) would never scale to zero and would burn
   * the free compute allowance 24/7. Liveness only answers "is the
   * Node process up?" — a dependency check belongs in readiness
   * (`/health/db`), not liveness (a DB blip shouldn't restart the app).
   */
  @Get()
  @ApiOperation({ summary: 'Liveness probe (no DB — process up?)' })
  @ApiResponse({ status: 200, description: 'Process is up' })
  check() {
    return { status: 'ok', uptime: Math.round(process.uptime()) };
  }

  /**
   * Readiness / deep check — pings the database. Use this for manual
   * troubleshooting or a low-frequency external monitor, NOT as the
   * Railway liveness probe (see above). Returns 503 if the DB is down.
   */
  @Get('db')
  @HealthCheck()
  @ApiOperation({ summary: 'Readiness check (pings the database)' })
  @ApiResponse({ status: 200, description: 'Database reachable' })
  @ApiResponse({ status: 503, description: 'Database unreachable' })
  checkDb() {
    // A cold connection to Neon (fresh TCP + TLS + auth after the pool
    // dropped its idle sockets) takes 1–2 s when the API and the
    // database sit in different regions; Terminus' default 1 s timeout
    // reported a perfectly healthy database as down.
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 5000 }),
    ]);
  }

  /**
   * App configuration endpoint (mobile-first)
   *
   * Returns app version requirements and feature flags.
   * No authentication required — used by mobile clients before login.
   */
  @Get('/config')
  @ApiOperation({ summary: 'App configuration (mobile)' })
  @ApiResponse({
    status: 200,
    description: 'App configuration and feature flags',
    schema: {
      example: {
        minimumVersion: '1.0.0',
        latestVersion: '1.0.0',
        forceUpdate: false,
        maintenanceMode: false,
        features: {
          payments: false,
          liveSession: false,
          chat: false,
          pushNotifications: false,
        },
      },
    },
  })
  getAppConfig() {
    return this.healthService.getAppConfig();
  }
}
