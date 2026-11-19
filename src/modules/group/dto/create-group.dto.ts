import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsBoolean,
  IsEnum,
  IsEmail,
  IsArray,
  MaxLength,
  ArrayMaxSize,
  ArrayUnique,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JoinPolicy, MemberPostPolicy } from '../entities/group.entity';
import { MAX_CATEGORIES_PER_PICK } from '../../category/dto/category-ids';

export class CreateGroupDto {
  @ApiProperty({
    example: 'Morning HIIT Crew',
    description: 'Group name',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({
    example: 'High-intensity interval training every weekday morning',
    description: 'Group description',
  })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: 'Europe/Bucharest',
    description: 'Timezone (defaults to Europe/Bucharest)',
  })
  @IsString()
  @IsOptional()
  timezone?: string;

  @ApiPropertyOptional({
    example: false,
    description: 'Make this group visible in public search',
  })
  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @ApiPropertyOptional({
    enum: JoinPolicy,
    example: JoinPolicy.INVITE_ONLY,
    description:
      'How new members join: OPEN (anyone), APPROVAL (needs approval), INVITE_ONLY',
  })
  @IsEnum(JoinPolicy)
  @IsOptional()
  joinPolicy?: JoinPolicy;

  @ApiPropertyOptional({
    enum: MemberPostPolicy,
    example: MemberPostPolicy.DISABLED,
    description:
      'Whether non-staff members can post in the group. ' +
      'OWNER/MODERATOR posts always bypass approval.',
  })
  @IsEnum(MemberPostPolicy)
  @IsOptional()
  memberPostPolicy?: MemberPostPolicy;

  @ApiPropertyOptional({
    example: ['fitness', 'hiit', 'morning'],
    description: 'Tags for categorization and search filtering',
    type: [String],
  })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({ example: 'trainer@example.com' })
  @IsEmail()
  @IsOptional()
  contactEmail?: string;

  @ApiPropertyOptional({ example: '+40712345678' })
  @IsString()
  @MaxLength(20)
  @IsOptional()
  contactPhone?: string;

  @ApiPropertyOptional({ example: 'Str. Victoriei 123, Sector 1' })
  @IsString()
  @MaxLength(500)
  @IsOptional()
  address?: string;

  @ApiPropertyOptional({ example: 'Bucharest' })
  @IsString()
  @MaxLength(100)
  @IsOptional()
  city?: string;

  @ApiPropertyOptional({ example: 'RO' })
  @IsString()
  @MaxLength(5)
  @IsOptional()
  country?: string;

  @ApiPropertyOptional({
    type: [String],
    maxItems: MAX_CATEGORIES_PER_PICK,
    description:
      'What the group trains: category ids of kind ACTIVITY from ' +
      '`GET /categories` (coaches only ones included). Optional.',
    example: ['0b1c2d3e-4f50-4a6b-8c7d-9e0f1a2b3c4d'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_CATEGORIES_PER_PICK)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  categoryIds?: string[];
}
