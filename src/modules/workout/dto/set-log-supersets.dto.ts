import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

/** More than any workout holds: every exercise of it can change group at once. */
export const MAX_SUPERSET_CHANGES = 100;

/** One logged exercise and the superset group it now belongs to. */
export class SetLogSupersetItemDto {
  @ApiProperty({ example: 'b1c2d3e4-0000-1111-2222-3333abcd6666' })
  @IsUUID()
  id!: string;

  @ApiProperty({
    example: 1,
    nullable: true,
    minimum: 0,
    maximum: 999,
    description:
      'Same value on neighbouring exercises = one superset. Null takes ' +
      'the exercise out of any superset.',
  })
  @ValidateIf((item: SetLogSupersetItemDto) => item.supersetGroupId !== null)
  @IsInt()
  @Min(0)
  @Max(999)
  supersetGroupId!: number | null;
}

/**
 * `PATCH /workout-logs/:id/supersets`: the logger's "Link as superset"
 * chip between two exercises, and its undo. The app works the new groups
 * out with the routine builder's rules and sends the exercises whose group
 * changed; they are saved in one transaction, so linking two supersets
 * (which renumbers both) is never left half done.
 */
export class SetLogSupersetsDto {
  @ApiProperty({ type: [SetLogSupersetItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_SUPERSET_CHANGES)
  @ArrayUnique((item: SetLogSupersetItemDto) => item.id)
  @ValidateNested({ each: true })
  @Type(() => SetLogSupersetItemDto)
  exercises!: SetLogSupersetItemDto[];
}
