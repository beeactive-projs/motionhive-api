import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  SequelizeHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';

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
    private health: HealthCheckService,
    private db: SequelizeHealthIndicator,
    private configService: ConfigService,
  ) {}

  /**
   * Basic health check
   *
   * Returns: { status: 'ok', info: {...}, error: {...}, details: {...} }
   *
   * Checks:
   * - Database connection (can we query MySQL?)
   * - Overall app status
   *
   * If ANY check fails, returns 503 Service Unavailable
   * If ALL checks pass, returns 200 OK
   */
  @Get()
  @HealthCheck()
  @ApiOperation({ summary: 'Health check endpoint' })
  @ApiResponse({
    status: 200,
    description: 'Application is healthy',
    schema: {
      example: {
        status: 'ok',
        info: {
          database: {
            status: 'up',
          },
        },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Application is unhealthy',
  })
  check() {
    return this.health.check([
      // Check database connection
      () => this.db.pingCheck('database'),
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
    return {
      minimumVersion: this.configService.get('APP_MIN_VERSION') || '1.0.0',
      latestVersion: this.configService.get('APP_LATEST_VERSION') || '1.0.0',
      forceUpdate: false,
      maintenanceMode: this.configService.get('MAINTENANCE_MODE') === 'true',
      features: {
        payments: false,
        liveSession: false,
        chat: false,
        pushNotifications: false,
      },
    };
  }
}
