import { IsArray, IsOptional, IsUUID, ArrayMinSize } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Selective delete:
 *   - groupIds omitted/empty → remove from ALL audiences (and soft-delete the post).
 *   - groupIds present → remove only those audiences. The post itself is
 *     auto-deleted when the last active audience is removed.
 *
 * The service additionally restricts a non-author moderator to groups
 * they actually moderate — they can't delete a post from a group they
 * don't moderate even if they pass the id.
 */
export class DeletePostDto {
  @ApiPropertyOptional({
    description:
      'Specific groups to remove the post from. Omit to remove from all.',
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  @IsOptional()
  groupIds?: string[];
}
