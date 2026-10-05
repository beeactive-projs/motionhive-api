import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Service for the public app-config endpoint consumed by mobile
 * clients before login (version gate, maintenance flag, feature
 * toggles). Lives in HealthModule because the existing controller
 * already exposes `/health` and `/health/config` is a sibling — we
 * just don't want the response shaping in the controller.
 */
@Injectable()
export class HealthService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Commit SHA of the running build, so "is my change live?" is one
   * request to `/health`. Railway sets RAILWAY_GIT_COMMIT_SHA on every
   * deploy from GitHub; null locally.
   */
  getCommit(): string | null {
    return this.configService.get<string>('RAILWAY_GIT_COMMIT_SHA') ?? null;
  }

  /**
   * Build the app-config payload. Static feature flags today; once we
   * have a real flag store (LaunchDarkly, GrowthBook, our own table)
   * this is the swap point.
   */
  getAppConfig(): {
    minimumVersion: string;
    latestVersion: string;
    forceUpdate: boolean;
    maintenanceMode: boolean;
    features: {
      payments: boolean;
      liveSession: boolean;
      chat: boolean;
      pushNotifications: boolean;
    };
  } {
    return {
      minimumVersion:
        this.configService.get<string>('APP_MIN_VERSION') ?? '1.0.0',
      latestVersion:
        this.configService.get<string>('APP_LATEST_VERSION') ?? '1.0.0',
      forceUpdate: false,
      maintenanceMode:
        this.configService.get<string>('MAINTENANCE_MODE') === 'true',
      features: {
        payments: false,
        liveSession: false,
        chat: false,
        pushNotifications: false,
      },
    };
  }
}
