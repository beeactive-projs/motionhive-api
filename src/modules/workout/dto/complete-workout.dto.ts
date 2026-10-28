import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/** Body for `POST /workout-logs/:id/complete`. */
export class CompleteWorkoutDto {
  @ApiPropertyOptional({ example: 4, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  feelingRating?: number;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  notes?: string;

  /** The line on the shared card. Empty clears it. */
  @ApiPropertyOptional({ maxLength: 80, example: 'First 100! The knee held.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  shareCaption?: string;
}
