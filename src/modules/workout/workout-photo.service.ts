import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';

import { apiError } from '../../common/i18n';
import { MediaStorageService } from '../../common/services/media-storage.service';
import { stripJpegMetadata } from '../../common/utils/image.utils';
import { CoachAccessService, isReadableByCoach } from './coach-access.service';
import { WorkoutLog } from './entities/workout-log.entity';
import { profileVisibleWhere } from './profile-visibility';
import { WorkoutLogStatus, WorkoutVisibility } from './entities/workout.enums';

/** The storage folder per person; account erasure deletes it. */
export const WORKOUT_PHOTO_RESOURCE = 'workout-photos';

/** The whole photo, or a small 3:4 crop for a grid of them. */
export type WorkoutPhotoSize = 'full' | 'thumb';

/**
 * One photo per finished workout, private by construction.
 *
 * Stored in the private bucket, which has no address at all, so no URL is
 * ever handed out: every read comes through here,
 * where the reader is checked the same way the workout itself is (the
 * owner, a coach `isReadableByCoach` lets in, or someone the profile shows
 * the workout to), and the bytes are streamed back. Location and other camera metadata are stripped before
 * the file is stored.
 */
@Injectable()
export class WorkoutPhotoService {
  constructor(
    @InjectModel(WorkoutLog) private readonly logModel: typeof WorkoutLog,
    private readonly mediaStorage: MediaStorageService,
    private readonly coachAccess: CoachAccessService,
  ) {}

  /**
   * Sets the workout's photo, replacing any before it at the same public
   * id. Finished workouts only: an unfinished one can still be discarded,
   * and a photo must never outlive its workout.
   */
  async setPhoto(
    workoutLogId: string,
    userId: string,
    file: Express.Multer.File,
  ): Promise<{ hasPhoto: true; photoVersion: number }> {
    const log = await this._owned(workoutLogId, userId);
    if (log.status !== WorkoutLogStatus.Completed) {
      throw new BadRequestException(apiError('workout.photoNotFinished'));
    }
    // The app sends a re-encoded JPEG; anything else is not taken on trust.
    const jpeg = stripJpegMetadata(file.buffer);
    if (!jpeg) throw new BadRequestException(apiError('workout.photoJpegOnly'));

    const { publicId, version } = await this.mediaStorage.uploadPrivateImage(
      jpeg,
      this.mediaStorage.buildPrivateFolder(WORKOUT_PHOTO_RESOURCE, userId),
      log.id,
    );
    await log.update({ photoPublicId: publicId, photoVersion: version });
    return { hasPhoto: true, photoVersion: version };
  }

  async removePhoto(workoutLogId: string, userId: string): Promise<void> {
    const log = await this._owned(workoutLogId, userId);
    if (!log.photoPublicId) return;
    const publicId = log.photoPublicId;
    await log.update({ photoPublicId: null, photoVersion: null });
    await this.mediaStorage.deletePrivateImage(publicId);
  }

  /** The owner's own photo. 404 when there is none, like a missing workout. */
  async photoForOwner(
    workoutLogId: string,
    userId: string,
    size: WorkoutPhotoSize = 'full',
  ): Promise<Buffer> {
    const log = await this._owned(workoutLogId, userId);
    return this._bytes(log, size);
  }

  /**
   * A coach's read: the same gate as the workout's detail, so a photo is
   * seen by exactly the people who may open its workout. 404, not 403.
   */
  async photoForCoach(
    workoutLogId: string,
    instructorId: string,
  ): Promise<Buffer> {
    const log = await this.logModel.findByPk(workoutLogId, {
      attributes: [
        'id',
        'userId',
        'programAssignmentId',
        'visibility',
        'photoPublicId',
      ],
    });
    if (!log) throw new NotFoundException(apiError('workout.logNotFound'));
    const own = await this.coachAccess.readableAssignmentIds(
      instructorId,
      log.userId,
    );
    if (!isReadableByCoach(log, own)) {
      throw new NotFoundException(apiError('workout.logNotFound'));
    }
    return this._bytes(log);
  }

  /**
   * A profile's read: the photo of a workout the viewer may see on that
   * profile (finished, one of `levels`, not taken down), else a 404, so it
   * never confirms a hidden workout exists.
   */
  async photoForProfile(
    ownerId: string,
    levels: readonly WorkoutVisibility[],
    workoutLogId: string,
  ): Promise<Buffer> {
    const log = await this.logModel.findOne({
      where: { id: workoutLogId, ...profileVisibleWhere(ownerId, levels) },
      attributes: ['id', 'photoPublicId'],
    });
    if (!log) throw new NotFoundException(apiError('workout.logNotFound'));
    return this._bytes(log);
  }

  /**
   * Staff reviewing a report about this workout. The caller holds the
   * gate: only a reported workout's photo is asked for, and the admin
   * service writes the read to the audit log.
   */
  async photoForReview(workoutLogId: string): Promise<Buffer> {
    const log = await this.logModel.findByPk(workoutLogId, {
      attributes: ['id', 'photoPublicId'],
    });
    if (!log) throw new NotFoundException(apiError('workout.logNotFound'));
    return this._bytes(log);
  }

  private async _bytes(
    log: WorkoutLog,
    size: WorkoutPhotoSize = 'full',
  ): Promise<Buffer> {
    if (!log.photoPublicId)
      throw new NotFoundException(apiError('workout.photoNotFound'));
    return this.mediaStorage.fetchPrivateImage(log.photoPublicId, {
      thumb: size === 'thumb',
    });
  }

  private async _owned(id: string, userId: string): Promise<WorkoutLog> {
    const log = await this.logModel.findByPk(id);
    if (!log || log.userId !== userId) {
      throw new NotFoundException(apiError('workout.logNotFound'));
    }
    return log;
  }
}
