import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { IsStrongPassword } from '../../../common/validators/strong-password.validator';
import { Match } from '../../../common/validators/match.validator';

/**
 * Reset Password DTO
 *
 * Used when user clicks the reset link from email.
 */
export class ResetPasswordDto {
  @ApiProperty({
    example: 'abc123def456...',
    description: 'Password reset token from email',
  })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({
    example: 'NewSecureP@ssw0rd!',
    description: 'New password (must be strong)',
    minLength: 8,
  })
  @IsString()
  @IsNotEmpty()
  @IsStrongPassword()
  newPassword: string;

  @ApiProperty({
    example: 'NewSecureP@ssw0rd!',
    description: 'Must match the newPassword field exactly',
  })
  @IsString()
  @IsNotEmpty()
  @Match('newPassword', { message: 'Passwords do not match' })
  confirmPassword: string;
}
