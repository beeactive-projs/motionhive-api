import { IsIn, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import type {
  PrivacyControlledField,
  ProfilePrivacyLevel,
} from '../../user/entities/user.entity';

/**
 * Allowed visibility values, kept in sync with `ProfilePrivacyLevel`
 * on the User entity. Validated via `@IsIn(...)` so each field rejects
 * anything outside this tuple at the boundary.
 */
const PRIVACY_LEVELS: ProfilePrivacyLevel[] = [
  'PUBLIC',
  'COACHES_ONLY',
  'ONLY_ME',
];

/**
 * Partial patch for `user.privacy_settings`. Every key is optional —
 * the service merges the supplied keys into the existing JSONB map,
 * so callers can flip a single field without sending the whole
 * settings object. Unknown keys are stripped by the global
 * `whitelist: true` ValidationPipe.
 *
 * Keys mirror `PrivacyControlledField` on the User entity.
 */
export class UpdatePrivacySettingsDto implements Partial<
  Record<PrivacyControlledField, ProfilePrivacyLevel>
> {
  @ApiPropertyOptional({ enum: PRIVACY_LEVELS, example: 'PUBLIC' })
  @IsOptional()
  @IsIn(PRIVACY_LEVELS)
  firstName?: ProfilePrivacyLevel;

  @ApiPropertyOptional({ enum: PRIVACY_LEVELS, example: 'PUBLIC' })
  @IsOptional()
  @IsIn(PRIVACY_LEVELS)
  lastName?: ProfilePrivacyLevel;

  @ApiPropertyOptional({ enum: PRIVACY_LEVELS, example: 'PUBLIC' })
  @IsOptional()
  @IsIn(PRIVACY_LEVELS)
  avatarUrl?: ProfilePrivacyLevel;

  @ApiPropertyOptional({ enum: PRIVACY_LEVELS, example: 'ONLY_ME' })
  @IsOptional()
  @IsIn(PRIVACY_LEVELS)
  email?: ProfilePrivacyLevel;

  @ApiPropertyOptional({ enum: PRIVACY_LEVELS, example: 'ONLY_ME' })
  @IsOptional()
  @IsIn(PRIVACY_LEVELS)
  phone?: ProfilePrivacyLevel;

  @ApiPropertyOptional({ enum: PRIVACY_LEVELS, example: 'PUBLIC' })
  @IsOptional()
  @IsIn(PRIVACY_LEVELS)
  city?: ProfilePrivacyLevel;

  @ApiPropertyOptional({ enum: PRIVACY_LEVELS, example: 'COACHES_ONLY' })
  @IsOptional()
  @IsIn(PRIVACY_LEVELS)
  language?: ProfilePrivacyLevel;

  @ApiPropertyOptional({ enum: PRIVACY_LEVELS, example: 'COACHES_ONLY' })
  @IsOptional()
  @IsIn(PRIVACY_LEVELS)
  timezone?: ProfilePrivacyLevel;

  /** The level new workouts start at; each workout can still be changed. */
  @ApiPropertyOptional({ enum: PRIVACY_LEVELS, example: 'ONLY_ME' })
  @IsOptional()
  @IsIn(PRIVACY_LEVELS)
  workouts?: ProfilePrivacyLevel;
}
