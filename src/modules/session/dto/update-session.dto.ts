import {
  IsOptional,
  IsString,
  IsEnum,
  IsNumber,
  IsDateString,
  IsBoolean,
  ValidateNested,
  MaxLength,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { RecurringRuleDto } from './recurring-rule.dto';

export class UpdateSessionDto {
  @ApiPropertyOptional({ example: 'Morning Yoga Flow - Updated' })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  title?: string;

  @ApiPropertyOptional({ example: 'Updated description' })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiPropertyOptional({
    example: 'GROUP',
    enum: ['ONE_ON_ONE', 'GROUP', 'ONLINE', 'WORKSHOP'],
  })
  @IsEnum(['ONE_ON_ONE', 'GROUP', 'ONLINE', 'WORKSHOP'])
  @IsOptional()
  sessionType?: string;

  @ApiPropertyOptional({
    example: 'GROUP',
    enum: ['PUBLIC', 'GROUP', 'CLIENTS', 'PRIVATE'],
  })
  @IsEnum(['PUBLIC', 'GROUP', 'CLIENTS', 'PRIVATE'])
  @IsOptional()
  visibility?: string;

  @ApiPropertyOptional({ example: '2026-02-15T10:00:00.000Z' })
  @IsDateString()
  @IsOptional()
  scheduledAt?: string;

  @ApiPropertyOptional({ example: 90 })
  @IsNumber()
  @Min(5)
  @Max(480)
  @IsOptional()
  durationMinutes?: number;

  @ApiPropertyOptional({ example: 'New Location' })
  @IsString()
  @MaxLength(255)
  @IsOptional()
  location?: string;

  @ApiPropertyOptional({ example: 25 })
  @IsNumber()
  @Min(1)
  @Max(1000)
  @IsOptional()
  maxParticipants?: number;

  @ApiPropertyOptional({ example: 60.0 })
  @IsNumber()
  @Min(0)
  @IsOptional()
  price?: number;

  @ApiPropertyOptional({
    example: 'CANCELLED',
    enum: ['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'],
  })
  @IsEnum(['DRAFT', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'])
  @IsOptional()
  status?: string;

  @ApiPropertyOptional({
    description: 'Toggle recurring; set recurringRule when true.',
  })
  @IsBoolean()
  @IsOptional()
  isRecurring?: boolean;

  @ApiPropertyOptional({ type: RecurringRuleDto })
  @ValidateNested()
  @Type(() => RecurringRuleDto)
  @IsOptional()
  recurringRule?: RecurringRuleDto;
}
