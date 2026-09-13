import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class ReorderPrescribedRowItemDto {
  @ApiProperty({ example: 'b2c3d4e5-1111-2222-3333-4444bcde5555' })
  @IsUUID()
  id: string;

  @ApiProperty({ example: 0, minimum: 0, maximum: 199 })
  @IsInt()
  @Min(0)
  @Max(199)
  orderIndex: number;
}

/**
 * New positions for the exercises of a workout, or the sets of an
 * exercise. Rows left out keep their index; the combined layout must not
 * put two rows at the same index. One transaction — a drag used to be one
 * PATCH per moved row, and a long list dragged twice tripped the rate
 * limit halfway through.
 */
export class ReorderPrescribedRowsDto {
  @ApiProperty({ type: [ReorderPrescribedRowItemDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ReorderPrescribedRowItemDto)
  items: ReorderPrescribedRowItemDto[];
}
