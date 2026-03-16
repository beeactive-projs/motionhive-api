import { IsString, IsNotEmpty, IsEmail, IsOptional, MaxLength, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateWaitlistDto {
  @ApiProperty({ example: 'john@example.com' })
  @IsEmail()
  @IsNotEmpty()
  email: string;

  @ApiPropertyOptional({ example: 'John Doe' })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    example: 'leader',
    enum: ['leader', 'participant'],
    description: 'Whether the person leads activities or participates',
  })
  @IsString()
  @IsOptional()
  @IsIn(['leader', 'participant'])
  role?: string;

  @ApiPropertyOptional({
    example: 'blog-cta',
    description: 'Where the signup came from (e.g. blog-cta, homepage, referral)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  source?: string;
}
