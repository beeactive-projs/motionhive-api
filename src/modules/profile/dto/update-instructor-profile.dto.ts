import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { SocialLinksDto } from './create-instructor-profile.dto';

class CertificationDto {
  @IsString()
  @MaxLength(200)
  name: string;

  @IsString()
  @MaxLength(200)
  issuer: string;

  @IsNumber()
  @Min(1900)
  @Max(2100)
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
  @MaxLength(4000)
  bio?: string;

  @ApiPropertyOptional({
    example: ['hiit', 'yoga', 'strength'],
    description: 'Training specializations',
  })
  @IsArray()
  @IsString({ each: true })
  // Bounds well past the apps' 20 of 60 characters: public text that
  // feeds the directory's facets and search.
  @ArrayMaxSize(50)
  @MaxLength(100, { each: true })
  @IsOptional()
  specializations?: string[];

  @ApiPropertyOptional({
    example: [{ name: 'ACE CPT', issuer: 'ACE', year: 2020 }],
    description: 'Professional certifications',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CertificationDto)
  @ArrayMaxSize(30)
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

  @ApiPropertyOptional({
    example: false,
    description:
      'Whether clients may name this coach on a workout they share outside the app (the share card coach line). Off by default.',
  })
  @IsBoolean()
  @IsOptional()
  allowClientMentions?: boolean;
}
