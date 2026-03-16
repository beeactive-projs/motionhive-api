import { IsString, IsNotEmpty, IsEmail, IsOptional, MaxLength, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { WaitlistRole } from '../../../common/enums/waitlist-role.enum';

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
    example: WaitlistRole.INSTRUCTOR,
    enum: WaitlistRole,
    description: 'Whether the person leads activities or participates',
  })
  @IsEnum(WaitlistRole)
  @IsOptional()
  role?: WaitlistRole;

  @ApiPropertyOptional({
    example: 'blog-cta',
    description: 'Where the signup came from (e.g. blog-cta, homepage, referral)',
  })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  source?: string;
}
