import { Inject, Injectable } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { JobsService } from '../jobs.service';
import { bucketKey } from './sessions.scheduler';

/**
 * Daily cron triggers for the `maintenance` queue. Enqueue only — no DB
 * work, no `setTimeout`. Skip-on-no-Redis preserved. Staggered through
 * the 04:00 hour, away from the payments reminder sweeps (06:00+).
 */
@Injectable()
export class MaintenanceScheduler {
  constructor(
    private readonly jobs: JobsService,
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    private readonly logger: LoggerService,
  ) {}

  private daily(name: Parameters<JobsService['enqueue']>[0]): Promise<unknown> {
    const runKey = bucketKey(24 * 60 * 60_000);
    return this.jobs.enqueue(name, { runKey }, { jobId: `${name}-${runKey}` });
  }

  @Cron('0 0 4 * * *') // 04:00
  async cleanupRefreshTokens(): Promise<void> {
    await this.daily('maintenance.cleanup_refresh_tokens');
  }

  @Cron('0 10 4 * * *') // 04:10
  async cleanupLockouts(): Promise<void> {
    await this.daily('maintenance.cleanup_lockouts');
  }

  @Cron('0 20 4 * * *') // 04:20
  async cleanupInvitations(): Promise<void> {
    await this.daily('maintenance.cleanup_invitations');
  }

  @Cron('0 30 4 * * *') // 04:30
  async cleanupClientRequests(): Promise<void> {
    await this.daily('maintenance.cleanup_client_requests');
  }

  // 04:40 UTC whatever the server's zone: account deletion gives people
  // this exact time as their erasure date (ERASURE_RUN_UTC).
  @Cron('0 40 4 * * *', { timeZone: 'UTC' })
  async eraseAccounts(): Promise<void> {
    await this.daily('maintenance.erase_accounts');
  }
}
