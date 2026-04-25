import { IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UpdateUserDto } from '../../user/dto/update-user.dto';
import { UpdateInstructorProfileDto } from './update-instructor-profile.dto';

/**
 * Update Full Profile DTO
 *
 * Unified DTO for updating account + instructor profile in one call.
 * All sections are optional — only provided sections are updated.
 * Country / city live on `account` (UpdateUserDto) now.
 */
export class UpdateFullProfileDto {
  @ApiPropertyOptional({
    description: 'Core user fields (name, phone, avatar, country, city, etc.)',
    type: UpdateUserDto,
  })
  @ValidateNested()
  @Type(() => UpdateUserDto)
  @IsOptional()
  account?: UpdateUserDto;

  @ApiPropertyOptional({
    description: 'Instructor profile fields (bio, specializations, etc.)',
    type: UpdateInstructorProfileDto,
  })
  @ValidateNested()
  @Type(() => UpdateInstructorProfileDto)
  @IsOptional()
  instructor?: UpdateInstructorProfileDto;
}
