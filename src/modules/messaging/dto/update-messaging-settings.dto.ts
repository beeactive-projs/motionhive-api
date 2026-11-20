import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { MessagePolicy } from '../../user/entities/user.entity';

const POLICIES = Object.values(MessagePolicy);

/** "Who can message you" (migration 090). */
export class UpdateMessagingSettingsDto {
  @ApiProperty({
    description:
      'EVERYONE: anyone lands in your chats. REQUESTS: people you are connected with go straight in, anyone else arrives as a message request. CONNECTIONS: only people you are connected with can start a chat.',
    enum: POLICIES,
  })
  @IsIn(POLICIES)
  whoCanMessage!: MessagePolicy;
}
