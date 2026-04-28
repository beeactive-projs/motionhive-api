import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsBoolean,
  IsNumber,
  IsArray,
  IsIn,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateBlogPostDto {
  @ApiProperty({ example: 'My First Blog Post' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  title: string;

  @ApiProperty({ example: 'my-first-blog-post' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  slug: string;

  @ApiProperty({ example: 'A short preview of the article...' })
  @IsString()
  @IsNotEmpty()
  excerpt: string;

  @ApiProperty({
    example: '<h2>Introduction</h2><p>This is my first blog post...</p>',
    description: 'HTML content of the blog post',
  })
  @IsString()
  @IsNotEmpty()
  content: string;

  @ApiProperty({
    example: 'Tips',
    description:
      'Category (Tips, Guide, Science, Nutrition, Wellness, Equipment)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  category: string;

  @ApiPropertyOptional({ example: 'https://res.cloudinary.com/...' })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  coverImage?: string;

  /**
   * Byline for guest contributors who don't have a registered account.
   * Leave undefined / null when the post is authored by the logged-in
   * user — the backend uses `req.user.id` to set `authorUserId` and
   * derives the byline from the user record at read time. Setting both
   * is rejected by the DB CHECK (`blog_post_author_xor`).
   */
  @ApiPropertyOptional({
    example: 'Sarah Johnson',
    description:
      'Byline for guest authors (no MotionHive account). Omit for posts ' +
      'written by the logged-in user — the byline is derived from the ' +
      'user record automatically.',
  })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  guestAuthorName?: string;

  @ApiPropertyOptional({
    example: 5,
    description: 'Estimated read time in minutes',
  })
  @IsNumber()
  @Min(1)
  @IsOptional()
  readTime?: number;

  @ApiPropertyOptional({ example: ['fitness', 'wellness', 'tips'] })
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @ApiPropertyOptional({
    example: 'en',
    description: 'Language of the post. Supported values: en, ro',
    enum: ['en', 'ro'],
  })
  @IsIn(['en', 'ro'], { message: 'language must be one of: en, ro' })
  @IsOptional()
  language?: string;

  @ApiPropertyOptional({ example: false, description: 'Publish immediately' })
  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;
}
