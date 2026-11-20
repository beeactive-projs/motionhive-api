import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsUUID } from 'class-validator';
import {
  SHARE_TARGET_TYPES,
  type ShareTargetType,
} from '../../share/share.types';

/** A public thing to send as a card: its type and id (migration 092). */
export class ShareRefDto {
  @ApiProperty({ enum: SHARE_TARGET_TYPES })
  @IsIn(SHARE_TARGET_TYPES)
  type!: ShareTargetType;

  @ApiProperty({
    description:
      'Session occurrence, group, coach (user id), exercise or starter program id',
  })
  @IsUUID()
  id!: string;
}
