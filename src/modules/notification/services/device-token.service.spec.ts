import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/sequelize';
import { Op } from 'sequelize';

import { DeviceTokenService } from './device-token.service';
import { DevicePlatform, DeviceToken } from '../entities/device-token.entity';
import {
  makeModelMock,
  type ModelMock,
} from '../../../../test/helpers/sequelize-mocks';

type DeviceStub = {
  id: string;
  userId: string;
  platform: DevicePlatform;
  token: string;
  endpointHash: string;
  deviceLabel: string | null;
  lastSeenAt: Date;
  revokedAt: Date | null;
  save: jest.Mock;
};

function makeDevice(overrides: Partial<DeviceStub> = {}): DeviceStub {
  return {
    id: 'd-1',
    userId: 'user-1',
    platform: DevicePlatform.WEB,
    token: 'old-token',
    endpointHash: 'hash-existing',
    deviceLabel: null,
    lastSeenAt: new Date('2026-01-01'),
    revokedAt: null,
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('DeviceTokenService', () => {
  let service: DeviceTokenService;
  let model: ModelMock;

  beforeEach(async () => {
    model = makeModelMock();
    const moduleRef = await Test.createTestingModule({
      providers: [
        DeviceTokenService,
        { provide: getModelToken(DeviceToken), useValue: model },
      ],
    }).compile();
    service = moduleRef.get(DeviceTokenService);
  });

  describe('register', () => {
    it('takes the device away from whoever was signed in on it before', async () => {
      model.findOne.mockResolvedValue(null);
      model.create.mockResolvedValue({ id: 'd-new' });

      await service.register({
        userId: 'user-2',
        platform: DevicePlatform.ANDROID,
        token: 'fcm-shared-phone',
      });

      // Every other account's active row for this phone, not this one's.
      expect(model.update).toHaveBeenCalledWith(
        { revokedAt: expect.any(Date) },
        {
          where: {
            endpointHash: expect.any(String),
            userId: { [Op.ne]: 'user-2' },
            revokedAt: { [Op.is]: null },
          },
        },
      );
    });

    it('creates a new row when no matching endpoint exists', async () => {
      model.findOne.mockResolvedValue(null);
      model.create.mockResolvedValue({ id: 'd-new' });

      await service.register({
        userId: 'user-1',
        platform: DevicePlatform.IOS,
        token: 'fcm-abc-123',
        deviceLabel: 'iPhone 14',
      });

      expect(model.create).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          platform: DevicePlatform.IOS,
          token: 'fcm-abc-123',
          deviceLabel: 'iPhone 14',
        }),
      );
    });

    it('upserts an existing row (same endpoint_hash) and bumps last_seen_at', async () => {
      const existing = makeDevice();
      const oldSeen = existing.lastSeenAt;
      model.findOne.mockResolvedValue(existing);

      await service.register({
        userId: 'user-1',
        platform: DevicePlatform.IOS,
        token: 'fcm-newer-token',
        deviceLabel: 'iPhone refreshed',
      });

      expect(model.create).not.toHaveBeenCalled();
      expect(existing.token).toBe('fcm-newer-token');
      expect(existing.platform).toBe(DevicePlatform.IOS);
      expect(existing.deviceLabel).toBe('iPhone refreshed');
      expect(existing.lastSeenAt).not.toBe(oldSeen);
      expect(existing.save).toHaveBeenCalled();
    });

    it('un-revokes when re-registering a previously revoked device', async () => {
      const existing = makeDevice({ revokedAt: new Date('2026-02-01') });
      model.findOne.mockResolvedValue(existing);

      await service.register({
        userId: 'user-1',
        platform: DevicePlatform.WEB,
        token: 'fresh',
      });

      expect(existing.revokedAt).toBeNull();
    });

    it('serializes web push subscription objects to JSON', async () => {
      model.findOne.mockResolvedValue(null);
      model.create.mockResolvedValue({ id: 'd-new' });

      await service.register({
        userId: 'user-1',
        platform: DevicePlatform.WEB,
        token: {
          endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
          keys: { p256dh: 'k1', auth: 'k2' },
        },
      });

      const calls = model.create.mock.calls as Array<
        [{ token: string; endpointHash: string }]
      >;
      const call = calls[0][0];
      expect(typeof call.token).toBe('string');
      expect(JSON.parse(call.token)).toEqual({
        endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
        keys: { p256dh: 'k1', auth: 'k2' },
      });
      // endpoint_hash is computed from the endpoint URL, not the whole subscription.
      expect(call.endpointHash).toMatch(/^[a-f0-9]{64}$/);
    });
  });

  describe('revoke', () => {
    it('sets revoked_at on an active device', async () => {
      const device = makeDevice();
      model.findOne.mockResolvedValue(device);
      await service.revoke('user-1', 'd-1');
      expect(device.revokedAt).toBeInstanceOf(Date);
      expect(device.save).toHaveBeenCalled();
    });

    it('is a no-op when already revoked', async () => {
      const previouslyRevoked = new Date('2026-01-01');
      const device = makeDevice({ revokedAt: previouslyRevoked });
      model.findOne.mockResolvedValue(device);
      await service.revoke('user-1', 'd-1');
      expect(device.revokedAt).toBe(previouslyRevoked);
      expect(device.save).not.toHaveBeenCalled();
    });

    it('throws 404 (not 403) when device is not owned by user', async () => {
      model.findOne.mockResolvedValue(null);
      await expect(service.revoke('user-1', 'd-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
