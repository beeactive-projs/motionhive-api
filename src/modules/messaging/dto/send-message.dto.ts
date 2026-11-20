import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ShareRefDto } from './share-ref.dto';

/**
 * Send a direct message to another user.
 *
 * v1 only supports DM-by-recipient. If a conversation between sender +
 * recipient already exists it's reused; otherwise it is created in the
 * same transaction as the message insert.
 *
 * Body cap enforced both here (@MaxLength 4000) and at the DB level
 * (CHECK constraint in migration 038) so a missing pipe in dev can't
 * sneak a too-long row past the database. The body may be empty only when
 * the message shares something (`attachment`, migration 092); the service
 * refuses an empty message otherwise (`messaging.emptyMessage`).
 */
export class SendMessageDto {
  @ApiProperty({
    example: '8b2a6f8b-9f93-4d11-9a4b-9c0a3a6c1b2e',
    description: 'UUID of the user to message',
  })
  @IsUUID('4')
  recipientId!: string;

  @ApiPropertyOptional({
    example: 'Running 5 minutes late. See you at the studio.',
    maxLength: 4000,
    description:
      'Plain-text message body (up to 4000 chars). Optional when sharing.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  body?: string;

  @ApiPropertyOptional({
    type: ShareRefDto,
    description: 'A public thing to send as a card',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ShareRefDto)
  attachment?: ShareRefDto;
}
