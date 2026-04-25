import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Feedback is accepted anonymously (used by the marketing website
 * too). To avoid turning the endpoint into an SMTP amplifier, the
 * confirmation mail — when sent — goes only to the email the
 * submitter entered, never to a client-supplied user id. A `userId`
 * is NOT accepted from the body; if the request is authenticated the
 * controller attaches it server-side from the JWT.
 */
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
  @MaxLength(5000)
  message: string;

  /**
   * Optional contact email provided by the submitter. Also where the
   * confirmation mail is sent (so an attacker can only spam themselves
   * or addresses they already control).
   */
  @ApiPropertyOptional({ example: 'user@example.com' })
  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  email?: string;
}
