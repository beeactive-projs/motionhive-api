import {
  IsOptional,
  IsString,
  IsArray,
  IsNumber,
  IsBoolean,
  MaxLength,
  Min,
  Max,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SocialLinksDto } from './create-instructor-profile.dto';

class CertificationDto {
  @IsString()
  name: string;

  @IsString()
  issuer: string;

  @IsNumber()
  year: number;
}

export class UpdateInstructorProfileDto {
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

  @ApiPropertyOptional({ example: 'Bucharest' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  locationCity?: string;

  @ApiPropertyOptional({ example: 'RO' })
  @IsString()
  @MaxLength(5)
  @IsOptional()
  locationCountry?: string;
}
