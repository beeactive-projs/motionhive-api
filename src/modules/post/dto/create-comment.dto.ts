import {
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({ example: 'Looking forward to it!' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content: string;

  @ApiPropertyOptional({
    description:
      'If set, this comment is a reply. Must point to a root comment ' +
      '(parentCommentId IS NULL); 1-level nesting is enforced server-side.',
  })
  @IsUUID('4')
  @IsOptional()
  parentCommentId?: string;
}
