import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  WORKOUT_DEFAULT_REST_MAX,
  WORKOUT_DEFAULT_REST_MIN,
  WORKOUT_SETTINGS_DEFAULTS,
  type WorkoutSettings,
} from '../workout-settings';

/**
 * `PATCH /users/me/workout-settings`: any subset of the settings. Keys not
 * sent keep their value; unknown keys are stripped by the global
 * `whitelist` ValidationPipe.
 */
export class UpdateWorkoutSettingsDto implements Partial<WorkoutSettings> {
  @ApiPropertyOptional({
    example: 120,
    minimum: WORKOUT_DEFAULT_REST_MIN,
    maximum: WORKOUT_DEFAULT_REST_MAX,
    default: WORKOUT_SETTINGS_DEFAULTS.defaultRestSeconds,
    description:
      'Rest after a set when nothing more specific is planned, in seconds.',
  })
  @IsOptional()
  @IsInt()
  @Min(WORKOUT_DEFAULT_REST_MIN)
  @Max(WORKOUT_DEFAULT_REST_MAX)
  defaultRestSeconds?: number;

  @ApiPropertyOptional({ default: WORKOUT_SETTINGS_DEFAULTS.sound })
  @IsOptional()
  @IsBoolean()
  sound?: boolean;

  @ApiPropertyOptional({ default: WORKOUT_SETTINGS_DEFAULTS.vibration })
  @IsOptional()
  @IsBoolean()
  vibration?: boolean;

  @ApiPropertyOptional({ default: WORKOUT_SETTINGS_DEFAULTS.lockScreen })
  @IsOptional()
  @IsBoolean()
  lockScreen?: boolean;

  @ApiPropertyOptional({ default: WORKOUT_SETTINGS_DEFAULTS.askEffort })
  @IsOptional()
  @IsBoolean()
  askEffort?: boolean;

  @ApiPropertyOptional({ default: WORKOUT_SETTINGS_DEFAULTS.supersetJump })
  @IsOptional()
  @IsBoolean()
  supersetJump?: boolean;

  @ApiPropertyOptional({ default: WORKOUT_SETTINGS_DEFAULTS.keepScreenOn })
  @IsOptional()
  @IsBoolean()
  keepScreenOn?: boolean;
}
