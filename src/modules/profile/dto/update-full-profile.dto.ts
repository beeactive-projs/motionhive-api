import { IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { UpdateUserDto } from '../../user/dto/update-user.dto';
import { UpdateUserProfileDto } from './update-user-profile.dto';
import { UpdateInstructorProfileDto } from './update-instructor-profile.dto';

/**
 * Update Full Profile DTO
 *
 * Unified DTO for updating user + user profile + instructor profiles in one call.
 * All sections are optional — only provided sections are updated.
 */
export class UpdateFullProfileDto {
  @ApiPropertyOptional({
    description: 'Core user fields (name, phone, avatar, etc.)',
    type: UpdateUserDto,
  })
  @ValidateNested()
  @Type(() => UpdateUserDto)
  @IsOptional()
  account?: UpdateUserDto;

  @ApiPropertyOptional({
    description: 'User profile fields (health, fitness data)',
    type: UpdateUserProfileDto,
  })
  @ValidateNested()
  @Type(() => UpdateUserProfileDto)
  @IsOptional()
  fitnessProfile?: UpdateUserProfileDto;

  @ApiPropertyOptional({
    description: 'Instructor profile fields (bio, specializations, etc.)',
    type: UpdateInstructorProfileDto,
  })
  @ValidateNested()
  @Type(() => UpdateInstructorProfileDto)
  @IsOptional()
  instructor?: UpdateInstructorProfileDto;
}
