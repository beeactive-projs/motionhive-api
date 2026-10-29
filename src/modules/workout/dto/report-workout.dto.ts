import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

import { MessageReportCategory } from '../../messaging/entities/message-report.entity';

/**
 * Body for reporting a workout on someone's profile. The categories are a
 * message report's, so the moderation queues share one vocabulary.
 */
export class ReportWorkoutDto {
  @ApiProperty({
    enum: MessageReportCategory,
    example: MessageReportCategory.SEXUAL,
  })
  @IsEnum(MessageReportCategory)
  category!: MessageReportCategory;

  @ApiPropertyOptional({
    description: 'What the reporter wants staff to know (max 1000 chars).',
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
