import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MinLength } from 'class-validator';
import { IsStrongPassword } from '../../../common/validators/strong-password.validator';
import { Match } from '../../../common/validators/match.validator';

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

  @ApiProperty({
    example: 'NewPassword456!',
    description: 'Must match the newPassword field exactly',
  })
  @IsString()
  @IsNotEmpty()
  @Match('newPassword', { message: 'Passwords do not match' })
  confirmPassword: string;
}
