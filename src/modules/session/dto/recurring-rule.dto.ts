import {
  IsEnum,
  IsOptional,
  IsNumber,
  IsDateString,
  IsArray,
  Min,
  Max,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Recurrence frequency.
 * - WEEKLY: repeat on selected days of the week (e.g. every Mon, Wed, Fri).
 * - DAILY: repeat every N days (interval applies).
 * - MONTHLY: repeat on the same day of the month (e.g. 15th of each month).
 */
export enum RecurrenceFrequency {
  DAILY = 'DAILY',
  WEEKLY = 'WEEKLY',
  MONTHLY = 'MONTHLY',
}

/**
 * Recurring rule for sessions (e.g. "Every Monday and Wednesday at 9:00 for 12 weeks").
 *
 * Stored in Session.recurringRule (JSON). When isRecurring is true, the first
 * session is created with scheduledAt = first occurrence; further instances
 * are created by POST /sessions/:id/generate-instances or by a future job.
 *
 * Frontend: use GET /sessions/:id/recurrence-preview to show dates on a calendar.
 */
export class RecurringRuleDto {
  @ApiProperty({
    enum: RecurrenceFrequency,
    example: RecurrenceFrequency.WEEKLY,
    description:
      'WEEKLY = repeat on selected days each week. DAILY = every N days. MONTHLY = same day each month.',
  })
  @IsEnum(RecurrenceFrequency)
  frequency: RecurrenceFrequency;

  @ApiPropertyOptional({
    example: 1,
    description:
      'Every N periods (e.g. 2 = every 2 weeks for WEEKLY). Default 1.',
    default: 1,
  })
  @IsNumber()
  @Min(1)
  @Max(99)
  @IsOptional()
  interval?: number = 1;

  /**
   * For WEEKLY: 0 = Sunday, 1 = Monday, ... 6 = Saturday.
   * Example: [1, 3, 5] = every Monday, Wednesday, Friday.
   * Ignored for DAILY and MONTHLY.
   */
  @ApiPropertyOptional({
    example: [1, 3, 5],
    description:
      'Days of week for WEEKLY (0=Sun..6=Sat). E.g. [1,3,5] = Mon, Wed, Fri.',
    type: [Number],
    minItems: 1,
  })
  @IsArray()
  @IsNumber({}, { each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  @ArrayMinSize(1)
  @IsOptional()
  daysOfWeek?: number[];

  @ApiPropertyOptional({
    example: '2026-06-30',
    description: 'Last date to generate occurrences (ISO date).',
  })
  @IsDateString()
  @IsOptional()
  endDate?: string;

  @ApiPropertyOptional({
    example: 12,
    description: 'Stop after this many occurrences (alternative to endDate).',
    minimum: 1,
    maximum: 365,
  })
  @IsNumber()
  @Min(1)
  @Max(365)
  @IsOptional()
  endAfterOccurrences?: number;
}
