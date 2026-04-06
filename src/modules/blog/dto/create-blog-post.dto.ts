import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsBoolean,
  IsNumber,
  IsArray,
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

  @ApiProperty({ example: 'Sarah Johnson' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  authorName: string;

  @ApiProperty({ example: 'SJ' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(10)
  authorInitials: string;

  @ApiProperty({ example: 'Certified Trainer' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  authorRole: string;

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

  @ApiPropertyOptional({ example: 'en', description: 'Language of the post (en, ro)' })
  @IsString()
  @IsOptional()
  language?: string;

  @ApiPropertyOptional({ example: false, description: 'Publish immediately' })
  @IsBoolean()
  @IsOptional()
  isPublished?: boolean;
}
