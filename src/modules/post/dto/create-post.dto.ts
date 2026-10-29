import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  ArrayMaxSize,
  ArrayMinSize,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePostDto {
  @ApiProperty({
    example: 'Big news for next week — new strength block kicks off Monday!',
    description: 'Post body, plain text. Newlines are preserved by the FE.',
  })
  // A shared workout can go without words, sent empty or left out: the
  // card says enough.
  @ValidateIf(
    (dto: CreatePostDto) => !dto.workoutLogId || (dto.content ?? '') !== '',
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  content: string;

  @ApiPropertyOptional({
    description:
      "One of the author's own finished workouts, shown as a card in the post.",
  })
  @IsOptional()
  @IsUUID('4')
  workoutLogId?: string;

  @ApiProperty({
    description: 'Group IDs the post should appear in. Min 1, max 9.',
    type: [String],
    example: ['c0a8...01', 'c0a8...02'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(9)
  @IsUUID('4', { each: true })
  groupIds: string[];

  @ApiPropertyOptional({
    description:
      'Cloudinary secure URLs returned by POST /posts/upload-image. Max 4.',
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(4)
  @IsUrl({}, { each: true })
  @IsOptional()
  mediaUrls?: string[];
}
