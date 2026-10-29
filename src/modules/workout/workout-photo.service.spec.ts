import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Op } from 'sequelize';
import { getModelToken } from '@nestjs/sequelize';

import { CloudinaryService } from '../../common/services/cloudinary.service';
import { CoachAccessService } from './coach-access.service';
import { WorkoutLog } from './entities/workout-log.entity';
import { WorkoutLogStatus } from './entities/workout.enums';
import { WorkoutPhotoService } from './workout-photo.service';

/** A minimal JPEG with an EXIF block that carries GPS. */
function jpegWithGps(): Buffer {
  const exif = Buffer.from('Exif\0\0GPSLatitude 44.43', 'latin1');
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    Buffer.from([0xff, 0xe1, 0, exif.length + 2]),
    exif,
    Buffer.from([0xff, 0xda, 0, 8, 1, 1, 0, 0, 0x3f, 0]),
    Buffer.from([0x12, 0x34]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

const file = (buffer: Buffer) => ({ buffer }) as Express.Multer.File;

describe('WorkoutPhotoService', () => {
  let service: WorkoutPhotoService;
  const logModel = { findByPk: jest.fn(), findOne: jest.fn() };
  const cloudinary = {
    uploadPrivateImage: jest
      .fn()
      .mockResolvedValue({ publicId: 'p/wl-1', version: 7 }),
    fetchPrivateImage: jest.fn().mockResolvedValue(Buffer.from('jpeg')),
    deletePrivateImage: jest.fn().mockResolvedValue(undefined),
    buildPrivateFolder: jest.fn(() => 'motionhive/test/workout-photos/me'),
  };
  const coachAccess = { readableAssignmentIds: jest.fn() };

  const finished = (fields: Record<string, unknown> = {}) => ({
    id: 'wl-1',
    userId: 'me',
    status: WorkoutLogStatus.Completed,
    photoPublicId: null,
    update: jest.fn().mockResolvedValue(undefined),
    ...fields,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        WorkoutPhotoService,
        { provide: getModelToken(WorkoutLog), useValue: logModel },
        { provide: CloudinaryService, useValue: cloudinary },
        { provide: CoachAccessService, useValue: coachAccess },
      ],
    }).compile();
    service = module.get(WorkoutPhotoService);
  });

  describe('setPhoto', () => {
    it('stores the photo without its location, privately, at the workout’s own id', async () => {
      const log = finished();
      logModel.findByPk.mockResolvedValueOnce(log);

      await expect(
        service.setPhoto('wl-1', 'me', file(jpegWithGps())),
      ).resolves.toEqual({
        hasPhoto: true,
        photoVersion: 7,
      });

      const [stored, folder, name] =
        cloudinary.uploadPrivateImage.mock.calls[0];
      expect((stored as Buffer).toString('latin1')).not.toContain('GPS');
      expect(folder).toBe('motionhive/test/workout-photos/me');
      expect(name).toBe('wl-1');
      expect(log.update).toHaveBeenCalledWith({
        photoPublicId: 'p/wl-1',
        photoVersion: 7,
      });
    });

    it('refuses a workout that is not finished', async () => {
      logModel.findByPk.mockResolvedValueOnce(
        finished({ status: WorkoutLogStatus.InProgress }),
      );
      await expect(
        service.setPhoto('wl-1', 'me', file(jpegWithGps())),
      ).rejects.toMatchObject({
        response: { messageKey: 'workout.photoNotFinished' },
      });
      expect(cloudinary.uploadPrivateImage).not.toHaveBeenCalled();
    });

    it('refuses anything but a JPEG, whose metadata it can strip', async () => {
      logModel.findByPk.mockResolvedValueOnce(finished());
      const png = Buffer.from([
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0,
      ]);
      await expect(
        service.setPhoto('wl-1', 'me', file(png)),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(cloudinary.uploadPrivateImage).not.toHaveBeenCalled();
    });

    it("hides someone else's workout", async () => {
      logModel.findByPk.mockResolvedValueOnce(finished({ userId: 'other' }));
      await expect(
        service.setPhoto('wl-1', 'me', file(jpegWithGps())),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('removes the stored file along with the reference', async () => {
    const log = finished({ photoPublicId: 'p/wl-1' });
    logModel.findByPk.mockResolvedValueOnce(log);

    await service.removePhoto('wl-1', 'me');

    expect(log.update).toHaveBeenCalledWith({
      photoPublicId: null,
      photoVersion: null,
    });
    expect(cloudinary.deletePrivateImage).toHaveBeenCalledWith('p/wl-1');
  });

  describe('photoForCoach — the same gate as the workout', () => {
    const coachRead = (fields: Record<string, unknown>) => {
      logModel.findByPk.mockResolvedValueOnce({
        id: 'wl-1',
        userId: 'client-1',
        photoPublicId: 'p/wl-1',
        ...fields,
      });
      coachAccess.readableAssignmentIds.mockResolvedValueOnce(['asg-mine']);
      return service.photoForCoach('wl-1', 'coach-1');
    };

    it('streams the photo of a workout from their own plan', async () => {
      await expect(
        coachRead({ programAssignmentId: 'asg-mine', visibility: 'ONLY_ME' }),
      ).resolves.toEqual(Buffer.from('jpeg'));
    });

    it('streams the photo of a workout the client shared', async () => {
      await expect(
        coachRead({ programAssignmentId: null, visibility: 'COACHES_ONLY' }),
      ).resolves.toEqual(Buffer.from('jpeg'));
    });

    it('404s on a private workout, without touching the file', async () => {
      await expect(
        coachRead({ programAssignmentId: null, visibility: 'ONLY_ME' }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(cloudinary.fetchPrivateImage).not.toHaveBeenCalled();
    });
  });

  it("streams the owner a small crop for History's grid when asked", async () => {
    logModel.findByPk.mockResolvedValueOnce(
      finished({ photoPublicId: 'p/wl-1' }),
    );
    await service.photoForOwner('wl-1', 'me', 'thumb');
    expect(cloudinary.fetchPrivateImage).toHaveBeenCalledWith('p/wl-1', {
      width: 480,
    });

    logModel.findByPk.mockResolvedValueOnce(
      finished({ photoPublicId: 'p/wl-1' }),
    );
    await service.photoForOwner('wl-1', 'me');
    expect(cloudinary.fetchPrivateImage).toHaveBeenLastCalledWith('p/wl-1', {});
  });

  describe('photoForProfile — whoever the profile shows the workout to', () => {
    it("looks the workout up under the viewer's levels, finished and not taken down", async () => {
      logModel.findOne.mockResolvedValueOnce({
        id: 'wl-1',
        photoPublicId: 'p/wl-1',
      });

      await expect(
        service.photoForProfile('owner', ['PUBLIC'], 'wl-1'),
      ).resolves.toEqual(Buffer.from('jpeg'));
      expect(logModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            id: 'wl-1',
            userId: 'owner',
            status: WorkoutLogStatus.Completed,
            visibility: { [Op.in]: ['PUBLIC'] },
            takenDownAt: null,
          },
        }),
      );
    });

    it('404s on a workout this viewer cannot see there, without touching the file', async () => {
      logModel.findOne.mockResolvedValueOnce(null);
      await expect(
        service.photoForProfile('owner', ['PUBLIC'], 'wl-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(cloudinary.fetchPrivateImage).not.toHaveBeenCalled();
    });

    it('404s when the workout has no photo', async () => {
      logModel.findOne.mockResolvedValueOnce({
        id: 'wl-1',
        photoPublicId: null,
      });
      await expect(
        service.photoForProfile('owner', ['PUBLIC'], 'wl-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
