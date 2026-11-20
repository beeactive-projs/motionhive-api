import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ShareRefDto } from './share-ref.dto';

/** Send one public thing to up to 10 people (`POST /messaging/shares`). */
export class ShareToDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 10 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  recipientIds!: string[];

  @ApiProperty({ type: ShareRefDto })
  @ValidateNested()
  @Type(() => ShareRefDto)
  attachment!: ShareRefDto;

  @ApiPropertyOptional({ maxLength: 4000 })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  caption?: string;
}
