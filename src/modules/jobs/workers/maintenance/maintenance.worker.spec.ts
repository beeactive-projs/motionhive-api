import { Test } from '@nestjs/testing';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { UnrecoverableError } from 'bullmq';
import { MaintenanceWorker } from './maintenance.worker';
import { MaintenanceService } from '../../../maintenance/maintenance.service';
import { AccountErasureService } from '../../../account-deletion/account-erasure.service';
import { makeSilentLogger } from '../../../../../test/helpers/sequelize-mocks';

const fakeJob = (name: string) =>
  ({
    data: {},
    queueName: 'maintenance',
    name,
    id: 'j',
    attemptsMade: 0,
  }) as unknown as Parameters<MaintenanceWorker['process']>[0];

describe('MaintenanceWorker', () => {
  let worker: MaintenanceWorker;
  const maintenance = {
    purgeExpiredRefreshTokens: jest.fn().mockResolvedValue({ deleted: 0 }),
    clearExpiredLockouts: jest.fn().mockResolvedValue({ cleared: 0 }),
    expireStaleInvitations: jest.fn().mockResolvedValue({ expired: 0 }),
    expireStaleClientRequests: jest.fn().mockResolvedValue({ expired: 0 }),
  };
  const accountErasure = {
    runDaily: jest
      .fn()
      .mockResolvedValue({ woundDown: 0, erased: 0, failed: 0, kept: 0 }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const ref = await Test.createTestingModule({
      providers: [
        MaintenanceWorker,
        { provide: MaintenanceService, useValue: maintenance },
        { provide: AccountErasureService, useValue: accountErasure },
        { provide: WINSTON_MODULE_NEST_PROVIDER, useValue: makeSilentLogger() },
      ],
    }).compile();
    worker = ref.get(MaintenanceWorker);
  });

  it.each([
    ['cleanup_refresh_tokens', () => maintenance.purgeExpiredRefreshTokens],
    ['cleanup_lockouts', () => maintenance.clearExpiredLockouts],
    ['cleanup_invitations', () => maintenance.expireStaleInvitations],
    ['cleanup_client_requests', () => maintenance.expireStaleClientRequests],
    ['erase_accounts', () => accountErasure.runDaily],
  ])(
    'routes %s to the right MaintenanceService method',
    async (name, getFn) => {
      await worker.process(fakeJob(name));
      expect(getFn()).toHaveBeenCalledTimes(1);
    },
  );

  it('unknown job name → UnrecoverableError', async () => {
    await expect(worker.process(fakeJob('bogus'))).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });
});
