import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** Archive (true) or unarchive (false) a chat for the caller. */
export class ArchiveConversationDto {
  @ApiProperty({ description: 'true archives the chat, false brings it back' })
  @IsBoolean()
  archived!: boolean;
}
