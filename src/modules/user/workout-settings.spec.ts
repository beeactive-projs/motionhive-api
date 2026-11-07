import { NotFoundException } from '@nestjs/common';

import { UserService } from './user.service';
import {
  resolveWorkoutSettings,
  WORKOUT_SETTINGS_DEFAULTS,
} from './workout-settings';
import { fakeTx } from '../../../test/helpers/sequelize-mocks';

describe('workout settings', () => {
  describe('resolveWorkoutSettings', () => {
    it('gives every default to an account that never changed one', () => {
      expect(resolveWorkoutSettings({})).toEqual({
        defaultRestSeconds: 90,
        sound: true,
        vibration: true,
        lockScreen: true,
        askEffort: false,
        supersetJump: true,
        keepScreenOn: true,
      });
      expect(resolveWorkoutSettings(null)).toEqual(WORKOUT_SETTINGS_DEFAULTS);
    });

    it('keeps what was changed and fills the rest', () => {
      expect(
        resolveWorkoutSettings({ defaultRestSeconds: 120, sound: false }),
      ).toEqual({
        ...WORKOUT_SETTINGS_DEFAULTS,
        defaultRestSeconds: 120,
        sound: false,
      });
    });

    it('never hands the app a stored value of the wrong type or range', () => {
      const stored = {
        defaultRestSeconds: 5,
        askEffort: 'yes',
      } as unknown as Record<string, unknown>;
      expect(resolveWorkoutSettings(stored)).toEqual(WORKOUT_SETTINGS_DEFAULTS);
    });
  });

  describe('UserService', () => {
    function setup(stored: Record<string, unknown> | null) {
      const user =
        stored === null
          ? null
          : {
              id: 'me',
              workoutSettings: stored,
              update: jest.fn().mockResolvedValue(undefined),
            };
      const userModel = { findByPk: jest.fn().mockResolvedValue(user) };
      const sequelize = {
        transaction: jest.fn((cb: (tx: typeof fakeTx) => unknown) =>
          Promise.resolve(cb(fakeTx)),
        ),
      };
      const service = new UserService(
        userModel as never,
        undefined as never,
        sequelize as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
      );
      return { service, user, userModel, sequelize };
    }

    it('reads the settings resolved', async () => {
      const { service } = setup({ keepScreenOn: false });

      await expect(service.getWorkoutSettings('me')).resolves.toEqual({
        ...WORKOUT_SETTINGS_DEFAULTS,
        keepScreenOn: false,
      });
    });

    it('404s for an account that is gone', async () => {
      const { service } = setup(null);
      await expect(service.getWorkoutSettings('me')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('merges the keys sent under a row lock and answers with all of them', async () => {
      const { service, user, userModel } = setup({ sound: false });

      const out = await service.updateWorkoutSettings('me', {
        defaultRestSeconds: 150,
        askEffort: true,
      });

      expect(userModel.findByPk).toHaveBeenCalledWith('me', {
        attributes: ['id', 'workoutSettings'],
        transaction: fakeTx,
        lock: fakeTx.LOCK.UPDATE,
      });
      expect(user!.update).toHaveBeenCalledWith(
        {
          workoutSettings: {
            sound: false,
            defaultRestSeconds: 150,
            askEffort: true,
          },
        },
        { transaction: fakeTx },
      );
      expect(out).toEqual({
        ...WORKOUT_SETTINGS_DEFAULTS,
        sound: false,
        defaultRestSeconds: 150,
        askEffort: true,
      });
    });

    it('puts a key sent as null back to its default', async () => {
      const { service, user } = setup({ sound: false, vibration: false });

      const out = await service.updateWorkoutSettings('me', {
        sound: null,
      } as unknown as { sound: boolean });

      expect(user!.update).toHaveBeenCalledWith(
        { workoutSettings: { vibration: false } },
        { transaction: fakeTx },
      );
      expect(out.sound).toBe(true);
      expect(out.vibration).toBe(false);
    });

    it('writes nothing for an empty patch', async () => {
      const { service, user, sequelize } = setup({});

      await service.updateWorkoutSettings('me', {});

      expect(sequelize.transaction).not.toHaveBeenCalled();
      expect(user!.update).not.toHaveBeenCalled();
    });
  });
});
