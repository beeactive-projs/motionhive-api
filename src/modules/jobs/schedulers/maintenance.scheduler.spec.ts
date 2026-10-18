import { MaintenanceScheduler } from './maintenance.scheduler';
import { JobsService } from '../jobs.service';
import { makeSilentLogger } from '../../../../test/helpers/sequelize-mocks';

describe('MaintenanceScheduler', () => {
  let scheduler: MaintenanceScheduler;
  let enqueue: jest.Mock;

  beforeEach(() => {
    enqueue = jest.fn().mockResolvedValue({ id: 'j' });
    scheduler = new MaintenanceScheduler(
      { enqueue } as unknown as JobsService,
      makeSilentLogger(),
    );
  });

  it.each([
    ['cleanupRefreshTokens', 'maintenance.cleanup_refresh_tokens'],
    ['cleanupLockouts', 'maintenance.cleanup_lockouts'],
    ['cleanupInvitations', 'maintenance.cleanup_invitations'],
    ['cleanupClientRequests', 'maintenance.cleanup_client_requests'],
    ['eraseAccounts', 'maintenance.erase_accounts'],
  ])('%s enqueues %s with a deterministic jobId', async (method, jobName) => {
    await (scheduler as unknown as Record<string, () => Promise<void>>)[
      method
    ]();
    expect(enqueue).toHaveBeenCalledWith(
      jobName,
      expect.objectContaining({ runKey: expect.any(String) }),
      expect.objectContaining({
        jobId: expect.stringContaining(`${jobName}-`) as string,
      }),
    );
  });
});
