import { IsIn, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * V1 only ships LIKE. The schema (VARCHAR(20)) supports more types
 * with no migration — adding LOVE/HAHA/etc. is a single line in this
 * @IsIn list and a UI palette.
 */
export class ToggleReactionDto {
  @ApiPropertyOptional({ description: 'Reaction type. Defaults to LIKE.' })
  @IsString()
  @IsIn(['LIKE'])
  @IsOptional()
  reactionType?: string;
}
