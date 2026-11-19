import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateInvitationDto {
  @ApiProperty({
    example: 'mike@trainer.com',
    description: 'Email of the person to invite',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiProperty({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Group ID to invite the person to',
  })
  @IsString()
  @IsNotEmpty()
  groupId: string;

  /**
   * Kept so a client that sends the old default still validates; USER is
   * the only role a group invitation gives. It used to take any role name,
   * SUPER_ADMIN included.
   */
  @ApiPropertyOptional({
    example: 'USER',
    enum: ['USER'],
    description: 'Always USER: a group invitation gives no other role.',
  })
  @IsOptional()
  @IsIn(['USER'])
  roleName?: string;

  @ApiPropertyOptional({
    example: 'Join my fitness group!',
    description: 'Personal message to include with the invitation',
  })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  message?: string;
}
