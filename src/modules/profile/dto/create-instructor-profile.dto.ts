import {
  IsOptional,
  IsString,
  IsArray,
  IsNumber,
  IsBoolean,
  IsUrl,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Create Instructor Profile DTO
 *
 * Sent when a user activates "I want to instruct activities".
 * All fields are optional — the user fills them in later.
 */
class CertificationDto {
  @IsString()
  name: string;

  @IsString()
  issuer: string;

  @IsNumber()
  year: number;
}

/**
 * Nested DTO for the `socialLinks` field. All platforms optional;
 * each accepts a URL with required protocol so instructors can't
 * submit bare usernames that break the link on the public profile.
 */
class SocialLinksDto {
  // Lock to http/https so stored links can't smuggle `javascript:` or
  // `data:` URIs into any consumer that forwards the raw value into
  // an `<a href>`, email body, or Slack card. Cap at 500 chars —
  // Instagram/TikTok URLs easily fit under that.
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  instagram?: string;
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  facebook?: string;
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  twitter?: string;
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  youtube?: string;
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  tiktok?: string;
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  linkedin?: string;
  @IsOptional()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(500)
  website?: string;
}
export { SocialLinksDto };

export class CreateInstructorProfileDto {
  @ApiPropertyOptional({
    example: 'Coach John',
    description: 'Professional display name',
  })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  displayName?: string;

  @ApiPropertyOptional({
    example: 'Certified personal trainer with 5 years experience',
  })
  @IsString()
  @IsOptional()
  @MaxLength(4000)
  bio?: string;

  @ApiPropertyOptional({
    example: ['hiit', 'yoga', 'strength'],
    description: 'Training specializations',
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  specializations?: string[];

  @ApiPropertyOptional({
    example: [{ name: 'ACE CPT', issuer: 'ACE', year: 2020 }],
    description: 'Professional certifications',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CertificationDto)
  @IsOptional()
  certifications?: CertificationDto[];

  @ApiPropertyOptional({ example: 5 })
  @IsNumber()
  @Min(0)
  @Max(50)
  @IsOptional()
  yearsOfExperience?: number;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isAcceptingClients?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @ApiPropertyOptional({
    type: SocialLinksDto,
    example: {
      instagram: 'https://instagram.com/coach_john',
      facebook: 'https://facebook.com/CoachJohn',
    },
  })
  @ValidateNested()
  @Type(() => SocialLinksDto)
  @IsOptional()
  socialLinks?: SocialLinksDto;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  showSocialLinks?: boolean;

  @ApiPropertyOptional({ example: true })
  @IsBoolean()
  @IsOptional()
  showEmail?: boolean;

  @ApiPropertyOptional({ example: false })
  @IsBoolean()
  @IsOptional()
  showPhone?: boolean;
}
