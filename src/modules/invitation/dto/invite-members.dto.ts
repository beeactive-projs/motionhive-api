import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsUUID,
} from 'class-validator';

/** The owner inviting several of their own clients to a group at once. */
export class InviteMembersDto {
  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'The group to invite them to (the caller must own it)',
  })
  @IsUUID('4')
  groupId: string;

  @ApiProperty({
    type: [String],
    description:
      "User ids of the caller's active clients. Members and people already invited are skipped.",
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  userIds: string[];
}
