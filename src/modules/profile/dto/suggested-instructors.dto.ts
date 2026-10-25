import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class SuggestedInstructorsDto {
  @ApiPropertyOptional({
    example: 10,
    description: 'How many coaches to suggest',
    default: 10,
  })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(20)
  @IsOptional()
  limit?: number = 10;
}
