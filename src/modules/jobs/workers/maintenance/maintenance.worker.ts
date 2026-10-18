import { Inject } from '@nestjs/common';
import type { LoggerService } from '@nestjs/common';
import { Processor } from '@nestjs/bullmq';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AccountErasureService } from '../../../account-deletion/account-erasure.service';
import { MaintenanceService } from '../../../maintenance/maintenance.service';
import { JobHandler, MultiJobWorker } from '../../common/multi-job.worker';
import { QueueName } from '../../job-registry';

/**
 * Processor for the `maintenance` queue — bulk housekeeping sweeps.
 * Thin handlers delegate to MaintenanceService.
 */
@Processor(QueueName.Maintenance)
export class MaintenanceWorker extends MultiJobWorker {
  constructor(
    @Inject(WINSTON_MODULE_NEST_PROVIDER)
    logger: LoggerService,
    private readonly maintenance: MaintenanceService,
    private readonly accountErasure: AccountErasureService,
  ) {
    super(logger);
  }

  protected readonly handlers: Record<string, JobHandler> = {
    cleanup_refresh_tokens: async (_p, ctx) => {
      const r = await this.maintenance.purgeExpiredRefreshTokens(new Date());
      ctx.log.log(`refresh tokens deleted=${r.deleted}`);
    },
    cleanup_lockouts: async (_p, ctx) => {
      const r = await this.maintenance.clearExpiredLockouts(new Date());
      ctx.log.log(`lockouts cleared=${r.cleared}`);
    },
    cleanup_invitations: async (_p, ctx) => {
      const r = await this.maintenance.expireStaleInvitations(new Date());
      ctx.log.log(`invitations expired=${r.expired}`);
    },
    cleanup_client_requests: async (_p, ctx) => {
      const r = await this.maintenance.expireStaleClientRequests(new Date());
      ctx.log.log(`client requests expired=${r.expired}`);
    },
    erase_accounts: async (_p, ctx) => {
      const r = await this.accountErasure.runDaily(new Date());
      ctx.log.log(
        `accounts erased=${r.erased} failed=${r.failed} kept=${r.kept} wind-downs finished=${r.woundDown}`,
      );
    },
  };
}
