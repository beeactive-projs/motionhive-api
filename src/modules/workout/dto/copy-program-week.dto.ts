import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * Body for `POST /programs/:id/workouts/copy-week`.
 *
 * Exists so copying a week is one request rather than one per workout, per
 * exercise, per set — a client walking the tree itself made ~36 calls for a
 * modest week and tripped the global throttle on the second copy.
 *
 * `toWeekIndexes` copies into several weeks in the same request ("make weeks
 * 2 to 6 like week 1"), so the app never loops one copy per target week.
 * `toWeekIndex` is the single target older apps send; one of the two is
 * required, and the list wins when both come.
 */
export class CopyProgramWeekDto {
  /** 0-based week to copy from. */
  @ApiProperty({ example: 0, minimum: 0, maximum: 103 })
  @IsInt()
  @Min(0)
  @Max(103)
  fromWeekIndex: number;

  /** 0-based week to copy into. Anything already there is replaced. */
  @ApiPropertyOptional({
    example: 1,
    minimum: 0,
    maximum: 103,
    description: 'One target week. Required when `toWeekIndexes` is not sent.',
  })
  @ValidateIf((dto: CopyProgramWeekDto) => dto.toWeekIndexes === undefined)
  @IsInt()
  @Min(0)
  @Max(103)
  toWeekIndex?: number;

  /** 0-based weeks to copy into, in one transaction. Each is replaced. */
  @ApiPropertyOptional({
    example: [1, 2, 3],
    minimum: 0,
    maximum: 103,
    description:
      'Several target weeks at once. A week listed twice is copied once; ' +
      'the source week is left out.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(104)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(103, { each: true })
  toWeekIndexes?: number[];
}
