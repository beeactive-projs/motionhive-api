import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  ArrayMaxSize,
  MaxLength,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Audience (groupIds) is intentionally immutable post-creation.
 * Changing scope = delete + repost (avoids reaction/comment-leak
 * questions when audiences change after engagement has accrued).
 */
export class UpdatePostDto {
  @ApiPropertyOptional({ description: 'Updated post body.' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  @IsOptional()
  content?: string;

  @ApiPropertyOptional({
    description: 'Replacement media list. Pass [] to remove all.',
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(4)
  @IsUrl({}, { each: true })
  @IsOptional()
  mediaUrls?: string[];
}
