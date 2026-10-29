import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

import type { WorkoutPhotoSize } from '../workout-photo.service';

const SIZES: WorkoutPhotoSize[] = ['full', 'thumb'];

/** `GET /workout-logs/:id/photo`: the whole photo, or a grid thumbnail. */
export class WorkoutPhotoQueryDto {
  @ApiPropertyOptional({ enum: SIZES, example: 'thumb', default: 'full' })
  @IsOptional()
  @IsIn(SIZES)
  size?: WorkoutPhotoSize;
}
