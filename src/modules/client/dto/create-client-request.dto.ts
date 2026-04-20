import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Create Client Request DTO
 *
 * Used when an instructor invites a user to become their client.
 * Accepts an email address - the system resolves to a userId internally.
 */
export class CreateClientRequestDto {
  @ApiProperty({
    example: 'client@example.com',
    description: 'Email of the user to invite as a client',
  })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional({
    example: 'I would like to help you with your fitness goals!',
    description: 'Optional personal message to include with the request',
  })
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  message?: string;
}
