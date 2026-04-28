import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Promote/demote a group member. OWNER cannot be granted via this
 * endpoint — owner transfer is a separate flow with stricter checks
 * (and the partial unique index enforces "at most one OWNER per group").
 */
export enum AssignableMemberRole {
  MEMBER = 'MEMBER',
  MODERATOR = 'MODERATOR',
}

export class UpdateMemberRoleDto {
  @ApiProperty({ enum: AssignableMemberRole })
  @IsEnum(AssignableMemberRole)
  role: AssignableMemberRole;
}
