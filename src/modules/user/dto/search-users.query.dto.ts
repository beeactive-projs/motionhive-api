import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SearchUsersQueryDto {
  @ApiProperty({
    example: 'alice',
    description:
      'Search term — matches email, first name, or last name (case-insensitive).',
  })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q: string;

  @ApiPropertyOptional({
    example: 'USER',
    description: 'Filter by role name (e.g. USER, INSTRUCTOR).',
  })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  role?: string;

  @ApiPropertyOptional({
    example: true,
    description:
      'When true and the caller is an instructor, exclude users who already have an active or pending client relationship with the caller.',
  })
  @IsOptional()
  // `@Type(() => Boolean)` does NOT coerce the string "false" to
  // boolean false — JS `Boolean("false") === true`. Use Transform
  // to parse the actual query string.
  @Transform(({ value }) => value === true || value === 'true')
  excludeConnected?: boolean;

  @ApiPropertyOptional({ example: 10, minimum: 1, maximum: 20, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number = 10;
}
