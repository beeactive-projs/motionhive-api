import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { PaginationDto } from '../../../common/dto/pagination.dto';

/**
 * Whose eyes the owner previews their own profile through. Anyone else
 * cannot borrow a view, so the value is ignored for them.
 */
export type ProfilePreviewAs = 'PUBLIC' | 'COACH';

const PREVIEW_AS: ProfilePreviewAs[] = ['PUBLIC', 'COACH'];

const PREVIEW_AS_DOC = {
  enum: PREVIEW_AS,
  example: 'COACH',
  description:
    'Owner only: show the page as their active coaches see it. Ignored ' +
    'for anyone else. Default PUBLIC.',
};

/** `GET /profile/users/by-handle/:handle` and one workout on it. */
export class ProfileViewQueryDto {
  @ApiPropertyOptional(PREVIEW_AS_DOC)
  @IsOptional()
  @IsIn(PREVIEW_AS)
  previewAs?: ProfilePreviewAs;
}

/** `GET /profile/users/by-handle/:handle/workouts`. */
export class ProfileWorkoutsQueryDto extends PaginationDto {
  @ApiPropertyOptional(PREVIEW_AS_DOC)
  @IsOptional()
  @IsIn(PREVIEW_AS)
  previewAs?: ProfilePreviewAs;
}

/** `GET /profile/users/by-handle/:handle/workouts/:workoutLogId/photo`. */
export class ProfileWorkoutPhotoQueryDto extends ProfileViewQueryDto {
  @ApiPropertyOptional({
    example: 3,
    description:
      'The photo version from the summary. Ignored by the server; it gives ' +
      'a replaced photo a new address, so no cache serves the old one.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  v?: number;
}
