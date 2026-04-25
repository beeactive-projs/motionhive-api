import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Create Client Request DTO
 *
 * Used when an instructor invites someone to become their client.
 * Exactly one of `userId` or `email` must be provided:
 *  - `userId` — invite an existing platform user (picked from search).
 *  - `email`  — invite by email (may or may not already be registered).
 */
export class CreateClientRequestDto {
  @ApiPropertyOptional({
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'Existing platform user id. Mutually exclusive with `email`.',
  })
  @ValidateIf((o: CreateClientRequestDto) => !o.email)
  @IsUUID()
  userId?: string;

  @ApiPropertyOptional({
    example: 'client@example.com',
    description: 'Email to invite. Mutually exclusive with `userId`.',
  })
  @ValidateIf((o: CreateClientRequestDto) => !o.userId)
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    example: 'I would like to help you with your fitness goals!',
    description: 'Optional personal message to include with the request',
  })
  @IsString()
  @MaxLength(1000)
  @IsOptional()
  message?: string;
}
