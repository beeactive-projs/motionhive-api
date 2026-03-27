import {
  IsString,
  IsNotEmpty,
  MinLength,
  MaxLength,
  IsOptional,
  IsEmail,
  IsIn,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateFeedbackDto {
  @ApiProperty({ example: 'BUG', enum: ['BUG', 'SUGGESTION', 'OTHER'] })
  @IsString()
  @IsNotEmpty()
  @IsIn(['BUG', 'SUGGESTION', 'OTHER'])
  type: string;

  @ApiProperty({ example: 'Login button not working' })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(255)
  title: string;

  @ApiProperty({
    example: 'When I click the login button on mobile, nothing happens.',
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  message: string;

  @ApiPropertyOptional({ example: '550e8400-e29b-41d4-a716-446655440000' })
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsEmail()
  @IsOptional()
  email?: string;
}
