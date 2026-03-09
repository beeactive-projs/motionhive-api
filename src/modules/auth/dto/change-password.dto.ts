import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../../common/validators/strong-password.validator';

export class ChangePasswordDto {
  @ApiProperty({
    example: 'OldPassword123!',
    description: 'Current password',
  })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({
    example: 'NewPassword456!',
    description: 'New password (must be strong: 8+ chars, upper, lower, number, special)',
  })
  @IsString()
  @MinLength(8)
  @IsStrongPassword()
  newPassword: string;
}
