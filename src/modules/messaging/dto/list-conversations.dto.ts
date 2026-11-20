import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';
import type { ConversationFolder } from '../messaging.service';

const FOLDERS: ConversationFolder[] = ['inbox', 'requests', 'archived'];

/**
 * Inbox list query. Inherits page/limit from PaginationDto.
 *
 * `folder` picks a part of the inbox (migration 090). Omitted, the list is
 * every chat but a deleted request, as before requests existed, for app
 * versions already in the stores.
 */
export class ListConversationsDto extends PaginationDto {
  @ApiPropertyOptional({
    description:
      'inbox: chats taken in and not archived. requests: message requests waiting for you. archived: chats you archived. Omit for everything but deleted requests (older apps).',
    enum: FOLDERS,
  })
  @IsOptional()
  @IsIn(FOLDERS)
  folder?: ConversationFolder;
}
